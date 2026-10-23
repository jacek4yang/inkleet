// Application-owned local test harness. User solution code is trusted; this is not a sandbox.
package main
import (
    "bufio"
    "encoding/json"
    "fmt"
    "os"
    "reflect"
    "strings"
)
type inkleetParameter struct { Name string `json:"name"`; Type string `json:"type"` }
type inkleetConfig struct {
    Metadata struct { Name string `json:"name"`; Params []inkleetParameter `json:"params"`; Return *inkleetParameter `json:"return"` } `json:"metadata"`
    Cases [][]json.RawMessage `json:"cases"`
}
func inkleetDecode(raw json.RawMessage, typ reflect.Type, kind string) (reflect.Value,error) {
    if strings.TrimSpace(string(raw))=="null" && kind!="ListNode" && kind!="TreeNode" {return reflect.Value{},fmt.Errorf("null is not valid for %s",kind)}
    if strings.HasSuffix(kind,"[]") {
        if typ.Kind()!=reflect.Slice && typ.Kind()!=reflect.Array {return reflect.Value{},fmt.Errorf("expected array parameter")}
        var values []json.RawMessage
        if err:=json.Unmarshal(raw,&values);err!=nil{return reflect.Value{},err}
        if len(values)>10000{return reflect.Value{},fmt.Errorf("array exceeds node limit")}
        var result reflect.Value
        if typ.Kind()==reflect.Array {if typ.Len()!=len(values){return reflect.Value{},fmt.Errorf("array length mismatch")};result=reflect.New(typ).Elem()}else{result=reflect.MakeSlice(typ,len(values),len(values))}
        for i,value:=range values {v,err:=inkleetDecode(value,typ.Elem(),strings.TrimSuffix(kind,"[]"));if err!=nil{return reflect.Value{},err};result.Index(i).Set(v)}
        return result,nil
    }
    if kind=="ListNode"||kind=="TreeNode" {
        if typ.Kind()!=reflect.Pointer || typ.Elem().Kind()!=reflect.Struct{return reflect.Value{},fmt.Errorf("node parameter must be a pointer")}
        if string(raw)=="null"{return reflect.Zero(typ),nil}
        var values []json.RawMessage
        if err:=json.Unmarshal(raw,&values);err!=nil{return reflect.Value{},err}
        if len(values)>10000{return reflect.Value{},fmt.Errorf("node input exceeds limit")}
        if len(values)==0{return reflect.Zero(typ),nil}
        node:=func(raw json.RawMessage)(reflect.Value,error){
            n:=reflect.New(typ.Elem());field:=n.Elem().FieldByName("Val")
            if !field.IsValid()||!field.CanSet(){return reflect.Value{},fmt.Errorf("node has no writable Val")}
            value,err:=inkleetDecode(raw,field.Type(),"integer");if err!=nil{return reflect.Value{},err};field.Set(value);return n,nil
        }
        if string(values[0])=="null" {
            for _,value:=range values {if string(value)!="null"{return reflect.Value{},fmt.Errorf("nodes without root")}}
            return reflect.Zero(typ),nil
        }
        root,err:=node(values[0]);if err!=nil{return reflect.Value{},err}
        if kind=="ListNode" {
            tail:=root
            for _,value:=range values[1:] {next,err:=node(value);if err!=nil{return reflect.Value{},err};field:=tail.Elem().FieldByName("Next");if !field.IsValid()||field.Type()!=typ{return reflect.Value{},fmt.Errorf("invalid Next field")};field.Set(next);tail=next}
            return root,nil
        }
        queue:=[]reflect.Value{root};index:=1
        for len(queue)>0 && index<len(values) {
            current:=queue[0];queue=queue[1:]
            for _,side:=range []string{"Left","Right"} {
                if index>=len(values){break};value:=values[index];index++
                if string(value)=="null"{continue}
                child,err:=node(value);if err!=nil{return reflect.Value{},err}
                field:=current.Elem().FieldByName(side);if !field.IsValid()||field.Type()!=typ{return reflect.Value{},fmt.Errorf("invalid tree field")}
                field.Set(child);queue=append(queue,child)
            }
        }
        for _,value:=range values[index:] {if string(value)!="null"{return reflect.Value{},fmt.Errorf("unreachable tree node")}}
        return root,nil
    }
    if kind=="character" {
        var text string;if err:=json.Unmarshal(raw,&text);err!=nil{return reflect.Value{},err};runes:=[]rune(text)
        if len(runes)!=1{return reflect.Value{},fmt.Errorf("expected one character")}
        result:=reflect.New(typ).Elem()
        switch typ.Kind() {
        case reflect.Uint8: if runes[0]>255{return reflect.Value{},fmt.Errorf("character exceeds byte")};result.SetUint(uint64(runes[0]))
        case reflect.Int32,reflect.Int: result.SetInt(int64(runes[0]))
        case reflect.String: result.SetString(text)
        default:return reflect.Value{},fmt.Errorf("unsupported character representation")
        };return result,nil
    }
    result:=reflect.New(typ)
    if err:=json.Unmarshal(raw,result.Interface());err!=nil{return reflect.Value{},err}
    return result.Elem(),nil
}
func inkleetEncode(value reflect.Value,kind string,budget *int)(any,error){
    *budget--
    if *budget<0{return nil,fmt.Errorf("result exceeds node limit")}
    if !value.IsValid(){return nil,nil}
    if value.Kind()==reflect.Interface{if value.IsNil(){return nil,nil};return inkleetEncode(value.Elem(),kind,budget)}
    if kind=="ListNode"||kind=="TreeNode" {
        if value.Kind()!=reflect.Pointer{return nil,fmt.Errorf("invalid returned node")}
        if value.IsNil(){return nil,nil}
        result:=[]any{};seen:=map[uintptr]bool{}
        queue:=[]reflect.Value{value}
        for len(queue)>0 {
            node:=queue[0];queue=queue[1:]
            if !node.IsValid()||node.IsNil(){result=append(result,nil);continue}
            if seen[node.Pointer()]{return nil,fmt.Errorf("result contains a cycle or shared node")};seen[node.Pointer()]=true
            if len(seen)>10000{return nil,fmt.Errorf("result exceeds node limit")}
            v,err:=inkleetEncode(node.Elem().FieldByName("Val"),"integer",budget);if err!=nil{return nil,err};result=append(result,v)
            if kind=="ListNode" {next:=node.Elem().FieldByName("Next");if next.IsValid()&&!next.IsNil(){queue=append(queue,next)}}else{queue=append(queue,node.Elem().FieldByName("Left"),node.Elem().FieldByName("Right"))}
        }
        if kind=="TreeNode"{for len(result)>0&&result[len(result)-1]==nil{result=result[:len(result)-1]}}
        return result,nil
    }
    if value.Kind()==reflect.Slice||value.Kind()==reflect.Array {
        if value.Len()>10000{return nil,fmt.Errorf("result array exceeds limit")}
        result:=make([]any,value.Len());inner:=strings.TrimSuffix(kind,"[]")
        for i:=range result{v,err:=inkleetEncode(value.Index(i),inner,budget);if err!=nil{return nil,err};result[i]=v}
        return result,nil
    }
    if kind=="character"{
        if value.Kind()==reflect.String{return value.String(),nil}
        switch value.Kind(){case reflect.Uint8:return string(rune(value.Uint())),nil;case reflect.Int,reflect.Int32:return string(rune(value.Int())),nil}
    }
    switch value.Kind(){
    case reflect.Bool,reflect.String,reflect.Int,reflect.Int8,reflect.Int16,reflect.Int32,reflect.Int64,reflect.Uint,reflect.Uint8,reflect.Uint16,reflect.Uint32,reflect.Uint64,reflect.Float32,reflect.Float64:return value.Interface(),nil
    default:return nil,fmt.Errorf("unsupported result type %v",value.Type())
    }
}
func inkleetCase(function reflect.Value,config inkleetConfig,index int)(record map[string]any){
    record=map[string]any{"case":index+1,"ok":false}
    defer func(){if failure:=recover();failure!=nil{message:=fmt.Sprint(failure);if len(message)>1000{message=message[:1000]};record["error"]=message}}()
    raw:=config.Cases[index];typ:=function.Type()
    if typ.IsVariadic()||typ.NumIn()!=len(raw)||typ.NumOut()>1{panic("function signature does not match problem metadata")}
    args:=make([]reflect.Value,len(raw))
    for i,input:=range raw {value,err:=inkleetDecode(input,typ.In(i),config.Metadata.Params[i].Type);if err!=nil{panic(err)};args[i]=value}
    returned:=function.Call(args);kind:="";if config.Metadata.Return!=nil{kind=config.Metadata.Return.Type}
    budget:=10000
    if len(returned)>0{value,err:=inkleetEncode(returned[0],kind,&budget);if err!=nil{panic(err)};record["value"]=value}else{
        record["value"]=nil;after:=make([]any,len(args))
        for i,arg:=range args {value,err:=inkleetEncode(arg,config.Metadata.Params[i].Type,&budget);if err!=nil{panic(err)};after[i]=value};record["argumentsAfterCall"]=after
    }
    record["ok"]=true;return record
}
func main(){
    bytes,err:=os.ReadFile("input.json");if err!=nil{panic(err)}
    var config inkleetConfig;if err=json.Unmarshal(bytes,&config);err!=nil{panic(err)}
    if len(config.Cases)==0||len(config.Cases)>100{panic("case count exceeds limit")}
    output,err:=os.OpenFile("results.jsonl",os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if err!=nil{panic(err)};defer output.Close()
    writer:=bufio.NewWriter(output);defer writer.Flush();total:=0
    function:=reflect.ValueOf(__INKLEET_FUNCTION__)
    for index:=range config.Cases{
        record:=inkleetCase(function,config,index);line,err:=json.Marshal(record)
        if err!=nil{line,_=json.Marshal(map[string]any{"case":index+1,"ok":false,"error":err.Error()})}
        total+=len(line)+1;if total>1024*1024{panic("result file exceeds 1 MiB")}
        if _,err=writer.Write(append(line,'\n'));err!=nil{panic(err)};if err=writer.Flush();err!=nil{panic(err)}
    }
}
