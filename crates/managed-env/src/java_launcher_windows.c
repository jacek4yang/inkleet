// App-owned JNI bootstrap: per-process UTF-8, no system locale or JDK patch.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <jni.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
static char* utf8(const wchar_t* text){
    int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text,-1,NULL,0,NULL,NULL);
    if(!n)return NULL;char* out=(char*)malloc(n);
    if(!out||!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text,-1,out,n,NULL,NULL)){free(out);return NULL;}return out;
}
int wmain(int argc,wchar_t** argv){
    if(argc<3||GetACP()!=CP_UTF8){fprintf(stderr,"UTF-8 manifest or arguments missing\n");return 2;}
    wchar_t bin[32768],jvm_path[32768];
    if(swprintf(bin,32768,L"%ls\\bin",argv[1])<0||swprintf(jvm_path,32768,L"%ls\\bin\\server\\jvm.dll",argv[1])<0)return 2;
    DLL_DIRECTORY_COOKIE directory=AddDllDirectory(bin);
    if(!directory){fprintf(stderr,"private DLL directory unavailable: %lu\n",GetLastError());return 2;}
    HMODULE library=LoadLibraryExW(jvm_path,NULL,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_USER_DIRS|LOAD_LIBRARY_SEARCH_SYSTEM32);
    if(!library){fprintf(stderr,"private JVM unavailable: %lu\n",GetLastError());RemoveDllDirectory(directory);return 2;}
    typedef jint (JNICALL *CreateVM)(JavaVM**,void**,void*);
    CreateVM create=(CreateVM)GetProcAddress(library,"JNI_CreateJavaVM");
    if(!create)return 2;
    char* home_utf8=utf8(argv[1]);char* main_class=utf8(argv[2]);
    if(!home_utf8||!main_class)return 2;
    size_t home_len=strlen(home_utf8)+32;char* home=(char*)malloc(home_len);if(!home)return 2;
    snprintf(home,home_len,"-Djava.home=%s",home_utf8);
    JavaVMOption options[4]={{home,NULL},{"-Djava.class.path=.",NULL},{"-Xmx256m",NULL},{"-Xshare:off",NULL}};
    JavaVMInitArgs init={JNI_VERSION_1_8,4,options,JNI_FALSE};JavaVM* vm=NULL;JNIEnv* env=NULL;
    jint result=create(&vm,(void**)&env,&init);
    if(result!=JNI_OK){fprintf(stderr,"JNI startup failed: %d\n",result);return 3;}
    jclass main=(*env)->FindClass(env,main_class);
    if(!main){(*env)->ExceptionDescribe(env);return 4;}
    jmethodID method=(*env)->GetStaticMethodID(env,main,"main","([Ljava/lang/String;)V");
    jclass string=(*env)->FindClass(env,"java/lang/String");
    if(!method||!string){(*env)->ExceptionDescribe(env);return 4;}
    jobjectArray args=(*env)->NewObjectArray(env,argc-3,string,NULL);
    if(!args)return 4;
    for(int i=3;i<argc;i++){
        size_t size=wcslen(argv[i]);if(size>2147483647)return 4;
        jstring value=(*env)->NewString(env,(const jchar*)argv[i],(jsize)size);
        if(!value)return 4;
        (*env)->SetObjectArrayElement(env,args,i-3,value);(*env)->DeleteLocalRef(env,value);
    }
    (*env)->CallStaticVoidMethod(env,main,method,args);
    int exit_code=0;if((*env)->ExceptionCheck(env)){(*env)->ExceptionDescribe(env);exit_code=5;}
    if((*vm)->DestroyJavaVM(vm)!=JNI_OK)exit_code=6;
    free(home);free(home_utf8);free(main_class);FreeLibrary(library);RemoveDllDirectory(directory);
    return exit_code;
}
