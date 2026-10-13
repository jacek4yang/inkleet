import java.nio.file.*;import java.net.URI;import java.util.*;import java.util.concurrent.*;import java.util.function.Consumer;
import com.microsoft.java.debug.core.*;
import com.microsoft.java.debug.core.adapter.*;
import com.microsoft.java.debug.core.protocol.*;
import com.microsoft.java.debug.core.protocol.Types.*;
import com.sun.jdi.*;
import io.reactivex.Observable;
/** Stdio-only bootstrap around Microsoft's unchanged Java debug core.
 * No Eclipse plugin activation, listener, telemetry handler or extension code.
 */
public final class InkLeetJavaAdapter {
    static Path root;
    static final class Sources implements ISourceLookUpProvider {
        public boolean supportsRealtimeBreakpointVerification(){return false;}
        String className(String uri){
            Path path=Path.of(URI.create(uri)).normalize();
            if(!path.startsWith(root))throw new IllegalArgumentException("source outside snapshot");
            String name=path.getFileName().toString();
            if(!name.endsWith(".java"))throw new IllegalArgumentException("not Java source");
            return name.substring(0,name.length()-5);
        }
        @Deprecated public String[] getFullyQualifiedName(String uri,int[] lines,int[] columns){
            String[] result=new String[lines.length];Arrays.fill(result,className(uri));return result;
        }
        public JavaBreakpointLocation[] getBreakpointLocations(String uri,SourceBreakpoint[] points){
            JavaBreakpointLocation[] result=new JavaBreakpointLocation[points.length];String name=className(uri);
            for(int i=0;i<points.length;i++){result[i]=new JavaBreakpointLocation(points[i].line,points[i].column);result[i].setClassName(name);}
            return result;
        }
        @Deprecated public String getSourceFileURI(String qualified,String sourcePath){
            if(sourcePath==null)return null;
            Path path=root.resolve(sourcePath).normalize();return path.startsWith(root)&&Files.isRegularFile(path)?path.toUri().toString():null;
        }
        public String getSourceContents(String uri){
            try{Path p=Path.of(URI.create(uri)).normalize();if(!p.startsWith(root)||!Files.isRegularFile(p)||Files.size(p)>2097152)return null;return Files.readString(p);}catch(Exception e){return null;}
        }
        public List<MethodInvocation> findMethodInvocations(String uri,int line){return List.of();}
    }
    static final class Evaluation implements IEvaluationProvider {
        static CompletableFuture<Value> unsupported(){return CompletableFuture.failedFuture(new UnsupportedOperationException("Expression evaluation is not enabled"));}
        public boolean isInEvaluation(ThreadReference thread){return false;}
        public CompletableFuture<Value> evaluate(String expression,ThreadReference thread,int depth){return unsupported();}
        public CompletableFuture<Value> evaluate(String expression,ObjectReference object,ThreadReference thread){return unsupported();}
        public CompletableFuture<Value> evaluateForBreakpoint(IEvaluatableBreakpoint point,ThreadReference thread){return unsupported();}
        public CompletableFuture<Value> invokeMethod(ObjectReference object,String name,String signature,Value[] args,ThreadReference thread,boolean parent){return unsupported();}
        public void clearState(ThreadReference thread){}
    }
    static final class HotCode implements IHotCodeReplaceProvider {
        public void onClassRedefined(Consumer<List<String>> consumer){}
        public CompletableFuture<List<String>> redefineClasses(){return CompletableFuture.failedFuture(new UnsupportedOperationException("Immutable debug snapshot"));}
        public Observable<HotCodeReplaceEvent> getEventHub(){return Observable.never();}
    }

    /** Launch the Windows target through the same verified UTF-8 JNI bridge.
     * JDI listens only on explicit IPv4 loopback, with a bounded accept timeout.
     */
    static VirtualMachineManager vmManager(){
        VirtualMachineManager delegate=Bootstrap.virtualMachineManager();
        String bridge=System.getenv("INKLEET_PRIVATE_JAVA");
        if(bridge==null)return delegate;
        com.sun.jdi.connect.LaunchingConnector original=delegate.defaultConnector();
        com.sun.jdi.connect.LaunchingConnector connector=(com.sun.jdi.connect.LaunchingConnector)java.lang.reflect.Proxy.newProxyInstance(
            InkLeetJavaAdapter.class.getClassLoader(),new Class<?>[]{com.sun.jdi.connect.LaunchingConnector.class},(proxy,method,args)->{
                if(!method.getName().equals("launch"))return call(method,original,args);
                @SuppressWarnings("unchecked") Map<String,com.sun.jdi.connect.Connector.Argument> launch=(Map<String,com.sun.jdi.connect.Connector.Argument>)args[0];
                com.sun.jdi.connect.ListeningConnector listener=delegate.listeningConnectors().stream().filter(c->c.transport().name().equals("dt_socket")).findFirst().orElseThrow();
                Map<String,com.sun.jdi.connect.Connector.Argument> addressOptions=listener.defaultArguments();
                if(!addressOptions.containsKey("localAddress")||!addressOptions.containsKey("timeout"))throw new IllegalStateException("No bounded loopback JDI connector");
                addressOptions.get("localAddress").setValue("127.0.0.1");addressOptions.get("port").setValue("0");addressOptions.get("timeout").setValue("15000");
                String address=listener.startListening(addressOptions);Process child=null;
                try{
                    List<String> options=new ArrayList<>(DebugUtility.parseArguments(launch.get("options").value()));
                    // Java's CLI -cp flag is a JVM system property in the JNI invocation API.
                    List<String> vmOptions=new ArrayList<>();
                    for(int i=0;i<options.size();i++){
                        String option=options.get(i);
                        if(option.equals("-cp")||option.equals("-classpath")){if(++i>=options.size())throw new IllegalArgumentException("Missing classpath");vmOptions.add("-Djava.class.path="+options.get(i));}
                        else vmOptions.add(option);
                    }
                    vmOptions.add("-agentlib:jdwp=transport=dt_socket,server=n,suspend=y,address="+address);
                    List<String> command=new ArrayList<>(List.of(bridge,System.getProperty("java.home"),"--vmopts",Integer.toString(vmOptions.size())));
                    command.addAll(vmOptions);command.addAll(DebugUtility.parseArguments(launch.get("main").value()));
                    child=new ProcessBuilder(command).directory(root.toFile()).start();
                    VirtualMachine target=listener.accept(addressOptions);Process owned=child;
                    return java.lang.reflect.Proxy.newProxyInstance(InkLeetJavaAdapter.class.getClassLoader(),new Class<?>[]{VirtualMachine.class},(vmProxy,vmMethod,vmArgs)->{
                        if(vmMethod.getName().equals("process"))return owned;
                        return call(vmMethod,target,vmArgs);
                    });
                }catch(Throwable error){if(child!=null)child.destroyForcibly();throw error;}
                finally{listener.stopListening(addressOptions);}
            });
        return (VirtualMachineManager)java.lang.reflect.Proxy.newProxyInstance(InkLeetJavaAdapter.class.getClassLoader(),new Class<?>[]{VirtualMachineManager.class},(proxy,method,args)->{
            if(method.getName().equals("launchingConnectors"))return List.of(connector);
            if(method.getName().equals("defaultConnector"))return connector;
            return call(method,delegate,args);
        });
    }
    static Object call(java.lang.reflect.Method method,Object target,Object[] args)throws Throwable {
        try{return method.invoke(target,args);}catch(java.lang.reflect.InvocationTargetException error){throw error.getCause();}
    }

    public static void main(String[] args)throws Exception {
        if(args.length!=1)throw new IllegalArgumentException("snapshot root required");
        root=Path.of(args[0]).toRealPath();
        java.util.logging.LogManager.getLogManager().reset();
        DebugSettings settings=DebugSettings.getCurrent();settings.showLogicalStructure=false;settings.showToString=false;settings.maxStringLength=4000;
        settings.hotCodeReplace=DebugSettings.HotCodeReplace.NEVER;settings.javaHome=System.getProperty("java.home");
        ProviderContext context=new ProviderContext();
        context.registerProvider(IVirtualMachineManagerProvider.class,(IVirtualMachineManagerProvider)()->vmManager());
        context.registerProvider(ISourceLookUpProvider.class,new Sources());
        context.registerProvider(IEvaluationProvider.class,new Evaluation());
        context.registerProvider(IHotCodeReplaceProvider.class,new HotCode());
        context.registerProvider(ICompletionsProvider.class,(ICompletionsProvider)(frame,snippet,line,column)->List.of());
        new ProtocolServer(System.in,System.out,context){
            @Override public void sendResponse(Messages.Response response){
                if("initialize".equals(response.command)&&response.body instanceof Capabilities caps){
                    caps.supportsConditionalBreakpoints=false;caps.supportsHitConditionalBreakpoints=false;caps.supportsLogPoints=false;
                    caps.supportsEvaluateForHovers=false;caps.supportsCompletionsRequest=false;
                }
                super.sendResponse(response);
            }
        }.run();
    }
}
