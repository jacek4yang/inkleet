// Bounded serialization for trusted local solution code. Not a sandbox.
#pragma once
#include <algorithm>
#include <array>
#include <climits>
#include <cmath>
#include <cstdint>
#include <deque>
#include <fstream>
#include <functional>
#include <iomanip>
#include <limits>
#include <list>
#include <locale>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
struct ListNode;
struct TreeNode;
namespace inkleet {
struct Writer {
    std::string text;
    int budget=10000;
    void append(const std::string& value){
        if(text.size()+value.size()>1024*1024)throw std::runtime_error("result exceeds 1 MiB");
        text+=value;
    }
    void quote(const std::string& value){
        if(value.size()>1024*1024)throw std::runtime_error("string exceeds result limit");
        append("\"");
        for(unsigned char ch:value){
            switch(ch){
                case '"':append("\\\"");break;case '\\':append("\\\\");break;
                case '\b':append("\\b");break;case '\f':append("\\f");break;
                case '\n':append("\\n");break;case '\r':append("\\r");break;case '\t':append("\\t");break;
                default:if(ch<32){const char* digits="0123456789abcdef";std::string escape="\\u00";escape+=digits[ch>>4];escape+=digits[ch&15];append(escape);}else append(std::string(1,static_cast<char>(ch)));
            }
        }
        append("\"");
    }
    template<class T>void write(const T& value){
        using U=std::decay_t<T>;
        if(--budget<0)throw std::runtime_error("result exceeds node limit");
        if constexpr(std::is_same_v<U,ListNode*>){
            if(!value){append("null");return;}
            append("[");bool first=true;std::unordered_set<const void*> seen;
            for(auto* node=value;node;node=node->next){
                if(!seen.insert(node).second)throw std::runtime_error("cyclic list result");
                if(!first)append(",");first=false;write(node->val);
            }
            append("]");
        }else if constexpr(std::is_same_v<U,TreeNode*>){
            if(!value){append("null");return;}
            std::vector<std::string> items;std::queue<U> pending;std::unordered_set<const void*> seen;pending.push(value);
            while(!pending.empty()){
                auto* node=pending.front();pending.pop();
                if(!node){items.push_back("null");continue;}
                if(!seen.insert(node).second)throw std::runtime_error("cyclic or shared tree result");
                if(--budget<0)throw std::runtime_error("tree exceeds node limit");
                items.push_back(std::to_string(node->val));pending.push(node->left);pending.push(node->right);
            }
            while(!items.empty()&&items.back()=="null")items.pop_back();
            append("[");for(std::size_t i=0;i<items.size();i++){if(i)append(",");append(items[i]);}append("]");
        }else if constexpr(std::is_same_v<U,std::string>){quote(value);
        }else if constexpr(std::is_same_v<U,char>){if(static_cast<unsigned char>(value)>127)throw std::runtime_error("non-ASCII C++ char is unsupported");quote(std::string(1,value));
        }else if constexpr(std::is_same_v<U,bool>){append(value?"true":"false");
        }else if constexpr(std::is_integral_v<U>){append(std::to_string(value));
        }else if constexpr(std::is_floating_point_v<U>){
            if(!std::isfinite(value))throw std::runtime_error("non-finite result");
            std::ostringstream out;out.imbue(std::locale::classic());out<<std::setprecision(std::numeric_limits<U>::max_digits10)<<value;append(out.str());
        }else{
            if(value.size()>10000)throw std::runtime_error("array result exceeds limit");
            append("[");bool first=true;
            for(const auto& item:value){if(!first)append(",");first=false;write(static_cast<typename U::value_type>(item));}
            append("]");
        }
    }
};
template<class Call,class Arguments>
void run(std::ofstream& output,std::size_t& total,int index,Call call,Arguments arguments){
    Writer record;
    try{
        record.append("{\"case\":"+std::to_string(index)+",\"ok\":true,\"value\":");
        if constexpr(std::is_void_v<std::invoke_result_t<Call>>){
            call();record.append("null,\"argumentsAfterCall\":");arguments(record);
        }else{auto result=call();record.write(result);}
        record.append("}");
    }catch(const std::exception& error){
        record=Writer{};record.append("{\"case\":"+std::to_string(index)+",\"ok\":false,\"error\":");
        record.quote(std::string(error.what()).substr(0,1000));record.append("}");
    }catch(...){record=Writer{};record.append("{\"case\":"+std::to_string(index)+",\"ok\":false,\"error\":\"solution exception\"}");}
    total+=record.text.size()+1;if(total>1024*1024)throw std::runtime_error("results exceed 1 MiB");
    output<<record.text<<'\n';output.flush();if(!output)throw std::runtime_error("cannot write results");
}
}
