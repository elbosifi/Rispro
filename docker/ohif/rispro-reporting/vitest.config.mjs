import {fileURLToPath} from 'node:url';
const at=path=>fileURLToPath(new URL(path,import.meta.url));
export default {
  root:at('./'),
  resolve:{alias:[
    {find:'@ohif/ui-next',replacement:at('./test-ui.tsx')},
    {find:'react',replacement:at('../../../frontend/node_modules/react')},
    {find:'vitest',replacement:at('../../../frontend/node_modules/vitest/dist/index.js')},
    {find:'@testing-library/react',replacement:at('../../../frontend/node_modules/@testing-library/react/dist/index.js')},
    {find:'@',replacement:at('../../../frontend/src')},
  ]},
  plugins:[{name:'shared-dictation-source',enforce:'pre',resolveId(id){
    if(id.startsWith('./dictation-shared/')){
      const name=id.split('/').at(-1),folder=name.startsWith('use-')?'hooks':'lib';
      return at('../../../frontend/src/'+folder+'/'+name+'.ts');
    }
  }}],
  test:{environment:'jsdom',include:['*.test.tsx'],maxWorkers:1},
};
