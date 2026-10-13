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
    public static void main(String[] args)throws Exception {
        if(args.length!=1)throw new IllegalArgumentException("snapshot root required");
        root=Path.of(args[0]).toRealPath();
        java.util.logging.LogManager.getLogManager().reset();
        DebugSettings settings=DebugSettings.getCurrent();settings.showLogicalStructure=false;settings.showToString=false;settings.maxStringLength=4000;
        settings.hotCodeReplace=DebugSettings.HotCodeReplace.NEVER;settings.javaHome=System.getProperty("java.home");
        ProviderContext context=new ProviderContext();
        context.registerProvider(IVirtualMachineManagerProvider.class,(IVirtualMachineManagerProvider)()->Bootstrap.virtualMachineManager());
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
