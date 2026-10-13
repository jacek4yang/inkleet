import java.io.*; import java.nio.charset.StandardCharsets; import java.nio.file.*; import java.lang.reflect.Array; import java.util.*;
final class InkLeetJson {
    final StringBuilder text=new StringBuilder(); int budget=10000;
    final IdentityHashMap<Object,Boolean> seen=new IdentityHashMap<>();
    void push(String s){if(text.length()+s.length()>1048576)throw new IllegalArgumentException("result exceeds limit");text.append(s);}
    void node(){if(--budget<0)throw new IllegalArgumentException("result exceeds node limit");}
    void quote(String s){
        push("\"");for(int i=0;i<s.length();i++){
            char c=s.charAt(i);
            switch(c){
                case '"'->push("\\\"");case '\\'->push("\\\\");case '\n'->push("\\n");case '\r'->push("\\r");case '\t'->push("\\t");
                default->{if(c<' '||Character.isSurrogate(c))push(String.format("\\u%04x",(int)c));else push(String.valueOf(c));}
            }
        }push("\"");
    }
    void write(Object value){
        node();
        if(value==null){push("null");return;}
        if(value instanceof String s){quote(s);return;}
        if(value instanceof Character c){quote(c.toString());return;}
        if(value instanceof Boolean||value instanceof Byte||value instanceof Short||value instanceof Integer||value instanceof Long||value instanceof java.math.BigInteger){push(value.toString());return;}
        if(value instanceof Float f){if(!Float.isFinite(f))throw new IllegalArgumentException("non-finite result");push(f.toString());return;}
        if(value instanceof Double d){if(!Double.isFinite(d))throw new IllegalArgumentException("non-finite result");push(d.toString());return;}
        if(seen.put(value,true)!=null)throw new IllegalArgumentException("cyclic result");
        try {
            if(writeNode(value))return;
            if(value.getClass().isArray()){
                int size=Array.getLength(value);if(size>10000)throw new IllegalArgumentException("array result exceeds limit");
                push("[");for(int i=0;i<size;i++){if(i>0)push(",");write(Array.get(value,i));}push("]");return;
            }
            if(value instanceof Iterable<?> values){
                push("[");int i=0;for(Object item:values){if(i++>0)push(",");write(item);}push("]");return;
            }
            throw new IllegalArgumentException("unsupported result type");
        } finally {seen.remove(value);}
    }
    boolean writeNode(Object value){ __NODE_WRITERS__ return false; }
    static final class Sink implements AutoCloseable {
        final OutputStream output;int total=0;
        Sink()throws IOException{output=Files.newOutputStream(Path.of("results.jsonl"));}
        void emit(String text)throws IOException{
            byte[] bytes=(text+"\n").getBytes(StandardCharsets.UTF_8);total+=bytes.length;
            if(total>1048576)throw new IOException("results exceed 1 MiB");output.write(bytes);output.flush();
        }
        void failure(int index,Throwable error)throws IOException{
            InkLeetJson w=new InkLeetJson();w.push("{\"case\":"+index+",\"ok\":false,\"error\":");
            String message=error.getClass().getSimpleName()+": "+String.valueOf(error.getMessage());
            w.quote(message.substring(0,Math.min(message.length(),1000)));w.push("}");emit(w.text.toString());
        }
        public void close()throws IOException{output.close();}
    }
}
