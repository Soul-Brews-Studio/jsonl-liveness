// Label-based identity: independent of row order, session, and parent directory.
// Only a few characters are mixed; transcripts are never read or hashed here.
export function projectColor(project:string):string {
  const name=project.replaceAll("\\","/").split("/").filter(Boolean).at(-1)?.trim().toLowerCase()??"";
  let bucket=0;
  for(const char of name)bucket=(Math.imul(bucket,31)+char.codePointAt(0)!)>>>0;
  return `project-color-${((bucket^(bucket>>>16))>>>0)%8}`;
}
