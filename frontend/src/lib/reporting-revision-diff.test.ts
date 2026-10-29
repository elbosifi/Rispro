import {describe,it,expect} from 'vitest';
import {changedText} from './reporting-revision-diff';
describe('report revision comparison',()=>{
  it('preserves surrounding clinical text and highlights replacement',()=>{expect(changedText('No left lesion.','No right lesion.')).toEqual({prefix:'No ',removed:'lef',added:'righ',suffix:'t lesion.'});});
  it('represents additions, deletions, unchanged and empty revisions',()=>{
    expect(changedText('','New findings')).toEqual({prefix:'',removed:'',added:'New findings',suffix:''});
    expect(changedText('Removed','')).toEqual({prefix:'',removed:'Removed',added:'',suffix:''});
    expect(changedText('Normal','Normal')).toEqual({prefix:'Normal',removed:'',added:'',suffix:''});
  });
});
