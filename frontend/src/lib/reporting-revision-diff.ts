/** Linear comparison highlights the replaced span without quadratic work on large reports. */
export function changedText(before:string,after:string) {
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let end=0;while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  return {prefix:after.slice(0,start),removed:before.slice(start,before.length-end),added:after.slice(start,after.length-end),suffix:end?after.slice(-end):''};
}
