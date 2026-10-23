#pragma once
#include "cpp_harness.hpp"
#include "prototype.h"
#include <cstdlib>
#include <cstring>
inline char* inkleet_c_string(const std::string& value){
    auto* result=static_cast<char*>(std::malloc(value.size()+1));if(!result)throw std::bad_alloc();
    std::memcpy(result,value.data(),value.size());result[value.size()]=0;return result;
}
template<class T>auto inkleet_c_value(T value){
    if constexpr(std::is_same_v<T,char*>||std::is_same_v<T,const char*>){
        if(!value)throw std::runtime_error("null string result");
        std::size_t size=0;while(size<1024*1024&&value[size])size++;
        if(size==1024*1024)throw std::runtime_error("unterminated or oversized C string");
        return std::string(value,size);
    }else{return value;}
}
template<class T>auto inkleet_c_array(T* value,int size){
    if(size<0||size>10000||(!value&&size))throw std::runtime_error("invalid C array result length");
    std::vector<decltype(inkleet_c_value(T{}))> result;result.reserve(size);
    for(int i=0;i<size;i++)result.push_back(inkleet_c_value(value[i]));return result;
}
template<class T>auto inkleet_c_matrix(T** value,int rows,int* columns){
    if(rows<0||rows>10000||((!value||!columns)&&rows))throw std::runtime_error("invalid C matrix result dimensions");
    int total=0;for(int i=0;i<rows;i++){if(columns[i]<0||columns[i]>10000-total)throw std::runtime_error("C matrix exceeds node limit");total+=columns[i];}
    std::vector<decltype(inkleet_c_array(static_cast<T*>(nullptr),0))> result;result.reserve(rows);
    for(int i=0;i<rows;i++)result.push_back(inkleet_c_array(value[i],columns[i]));return result;
}
inline ListNode* inkleet_c_list(int value){auto* node=static_cast<ListNode*>(std::calloc(1,sizeof(ListNode)));if(!node)throw std::bad_alloc();node->val=value;return node;}
inline TreeNode* inkleet_c_tree(int value){auto* node=static_cast<TreeNode*>(std::calloc(1,sizeof(TreeNode)));if(!node)throw std::bad_alloc();node->val=value;return node;}
