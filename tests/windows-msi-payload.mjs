/** Tauri's MSI bundler patches one runtime bundle-type marker, then restores the
 * unbundled build output. Verify every installed byte against that exact patch;
 * do not normalize PE headers, signatures, timestamps, resources or arbitrary data.
 * Source: github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.0/crates/tauri-bundler/src/bundle.rs
 * patch_binary/restore; locked tauri-utils 2.10.1 src/platform.rs.
 */
import {createHash} from "node:crypto";
import {readFile,writeFile,stat} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import path from "node:path";
const sourceMarker=Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK"),msiMarker=Buffer.from("__TAURI_BUNDLE_TYPE_VAR_MSI");
if(sourceMarker.length!==msiMarker.length)throw Error("Tauri marker patch must preserve length");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export function inspectMsiPayload(built,installed){
 const evidence={result:"FAIL",rule:"tauri-single-bundle-marker-UNK-to-MSI",built_sha256:hash(built),installed_sha256:hash(installed),built_bytes:built.length,installed_bytes:installed.length};
 const offset=built.indexOf(sourceMarker);
 if(offset<0||built.indexOf(sourceMarker,offset+1)!==-1)return {...evidence,error:"Expected exactly one unbundled Tauri marker"};
 const expected=Buffer.from(built);msiMarker.copy(expected,offset);
 evidence.marker_offset=offset;evidence.marker_count=1;evidence.marker_bytes=sourceMarker.length;evidence.expected_sha256=hash(expected);evidence.expected_bytes=expected.length;
 if(!expected.equals(installed)){
  const differences=[];for(let i=0;i<Math.max(expected.length,installed.length)&&differences.length<32;i++)if(expected[i]!==installed[i])differences.push(i);
  return {...evidence,error:"Installed payload differs from the exact MSI-patched build",first_differing_offsets:differences};
 }
 return {...evidence,result:"PASS"};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [builtPath,installedPath,evidencePath]=process.argv.slice(2);
 if(!builtPath||!installedPath||!evidencePath)throw Error("Expected build, installed and evidence paths");
 for(const file of [builtPath,installedPath]){const info=await stat(file);if(!info.isFile()||info.size>200*1024*1024)throw Error("Invalid or oversized executable: "+file);}
 const result={...inspectMsiPayload(await readFile(builtPath),await readFile(installedPath)),built_path:path.resolve(builtPath),installed_path:path.resolve(installedPath),expected_path:null,expected_origin:"In-memory copy of built_path with the exact single Tauri UNK-to-MSI marker substitution; no files modified"};
 await writeFile(evidencePath,JSON.stringify(result,null,2));
 if(result.result!=="PASS")throw Error(result.error+"; exact hashes/byte sizes/paths in "+evidencePath);
 console.log("PASS: installed MSI executable matches every expected byte, allowing only Tauri's exact bundle-type patch");
}
