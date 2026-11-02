// Narrow source backports for OHIF 3.12.6 / Cornerstone 4.15.29 / VTK 34.15.1.
const fs = require('node:fs');
const path = require('node:path');

function configureVolumeShaderGuard(replace) {
  const mapper='node_modules/@kitware/vtk.js/Rendering/OpenGL/VolumeMapper.js';
  replace(mapper, '      // if the shader changed reinitialize the VAO', `      if (!newShader) {
        cellBO.setProgram(null);
        throw Object.assign(new Error('Volume shader compilation failed.'), { code: model.context?.isContextLost() ? 'context-lost' : 'shader-failed' });
      }
      // if the shader changed reinitialize the VAO`);
  replace(mapper, '      model._openGLRenderWindow.getShaderCache().readyShaderProgram(cellBO.getProgram());', `      const program = model._openGLRenderWindow.getShaderCache().readyShaderProgram(cellBO.getProgram());
      if (!program) {
        cellBO.setProgram(null);
        throw Object.assign(new Error('Volume shader binding failed.'), { code: model.context?.isContextLost() ? 'context-lost' : 'shader-failed' });
      }`);
  replace(mapper, '    // Now to update the VAO too, if necessary.\n    const program = cellBO.getProgram();', `    // Now to update the VAO too, if necessary.
    const program = cellBO.getProgram();
    if (!program) throw Object.assign(new Error('Volume shader unavailable.'), { code: 'shader-failed' });`);
}

function configureRenderingResilience(root) {
  for (const [pkg, version] of [['@cornerstonejs/core','4.15.29'], ['@kitware/vtk.js','34.15.1']]) {
    if (JSON.parse(fs.readFileSync(path.join(root,'node_modules',pkg,'package.json'),'utf8')).version !== version)
      throw Error('Rendering reliability backport version changed: ' + pkg);
  }
  const replace = (file, anchor, value) => {
    const filename=path.join(root,file), source=fs.readFileSync(filename,'utf8').replaceAll('\r\n','\n');
    if(source.split(anchor).length!==2)throw Error('Pinned rendering reliability anchor changed: '+file+' '+anchor.slice(0,70));
    fs.writeFileSync(filename,source.replace(anchor,value));
  };
  const core='node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/';
  const pool=core+'ContextPoolRenderingEngine.js';
  replace(pool, '            this._throwIfDestroyed();', `            if (this.hasBeenDestroyed || this._risproRenderingBlocked) {
                this._needsRender.clear(); this._animationFrameSet = false; this._animationFrameHandle = null; return;
            }`);
  replace(pool, `                const eventDetail = this.renderViewportUsingCustomOrVtkPipeline(viewport);
                viewport.setRendered();`, `                if (this._risproRenderingBlocked || viewport.isDisabled || !viewport.element.isConnected ||
                    viewport.element.clientWidth < 2 || viewport.element.clientHeight < 2) { this._needsRender.delete(viewport.id); return; }
                let eventDetail;
                try { eventDetail = this.renderViewportUsingCustomOrVtkPipeline(viewport); }
                catch (error) { this._risproFailRendering(error.code || (/out.of.memory|allocation/i.test(error.message || '') ? 'gpu-allocation-failed' : 'gpu-render-failed')); return; }
                if (!eventDetail) return;
                viewport.setRendered();`);
  replace(pool, '            this.contextPool = new WebGLContextPool(webGlContextCount);', `            this.contextPool = new WebGLContextPool(webGlContextCount);
            this.contextPool.getAllContexts().forEach(context => {
                const canvas = context.getOpenGLRenderWindow().getCanvas();
                canvas.risproRenderingEngineId = this.id;
                canvas.addEventListener('webglcontextlost', event => {
                    event.preventDefault();
                    if (!this.hasBeenDestroyed) this._risproFailRendering('context-lost');
                });
                canvas.addEventListener('webglcontextrestored', () => {
                    if (!this.hasBeenDestroyed) document.dispatchEvent(new CustomEvent('rispro-rendering-failure', { detail: { engineId: this.id, code: 'context-restored' } }));
                });
            });`);
  replace(pool, '    enableVTKjsDrivenViewport(viewportInputEntry) {', `    _risproFailRendering(code) {
        // A stale caller must not report a failure against a replacement
        // engine that now owns the same public id. The caller still receives
        // the classified destroyed-engine error from initialization.
        if (this.hasBeenDestroyed) return;
        this._risproRenderingBlocked = true;
        this._needsRender.clear();
        document.dispatchEvent(new CustomEvent('rispro-rendering-failure', { detail: { engineId: this.id, code } }));
    }
    enableVTKjsDrivenViewport(viewportInputEntry) {`);
  replace(pool, '        const { element, canvas, viewportId, type, defaultOptions } = viewportInputEntry;', `        const { element, canvas, viewportId, type, defaultOptions } = viewportInputEntry;
        if (this.hasBeenDestroyed || this._risproRenderingBlocked || !this.contextPool?.getContextCount() || this.useCPURendering !== getConfiguration().rendering.useCPURendering) {
            const code = this.hasBeenDestroyed ? 'engine-destroyed' : !this.contextPool?.getContextCount() ? 'context-pool-missing' : 'rendering-mode-mismatch';
            this._risproFailRendering(code);
            throw Object.assign(new Error('Rendering initialization stopped: ' + code), { code });
        }`);
  replace(pool, '        const context = openGLRenderWindow.get3DContext();', `        const context = openGLRenderWindow.get3DContext();
        if (!context || context.isContextLost()) throw Object.assign(new Error('Graphics context lost.'), { code: 'context-lost' });`);
  // Test context state BEFORE render as well: do not enter a shader path after loss.
  replace(pool, '        renderWindow.render();', `        if (offscreenMultiRenderWindow.getOpenGLRenderWindow().get3DContext()?.isContextLost())
            throw Object.assign(new Error('Graphics context lost.'), { code: 'context-lost' });
        renderWindow.render();`);
  replace(pool, `            canvas.width = canvas.clientWidth * devicePixelRatio;
            canvas.height = canvas.clientHeight * devicePixelRatio;`, `            const width = Math.floor(canvas.clientWidth * devicePixelRatio), height = Math.floor(canvas.clientHeight * devicePixelRatio);
            // Assigning the same dimensions clears the diagnostic canvas too.
            if (width >= 2 && height >= 2) {
                if (canvas.width !== width) canvas.width = width;
                if (canvas.height !== height) canvas.height = height;
            }`);
  const base=core+'BaseRenderingEngine.js';
  replace(base, '    _resetViewport(viewport) {', `    _resetViewport(viewport) {
        clearTimeout(viewport.debouncedTimeout);
        viewport._risproSelection = {};
        viewport._risproDataRequest = {};`);
  replace(base, '        context.clearRect(0, 0, canvas.width, canvas.height);', `        context.clearRect(0, 0, canvas.width, canvas.height);
        viewport.isDisabled = true;`);
  replace(base, `    resize(immediate = true, keepCamera = true) {
        this._throwIfDestroyed();
        const viewports = this._getViewportsAsArray();`, `    resize(immediate = true, keepCamera = true) {
        this._throwIfDestroyed();
        if (this._risproRenderingBlocked) return;
        const viewports = this._getViewportsAsArray().filter(v => !v.isDisabled && v.element.isConnected && v.element.clientWidth >= 2 && v.element.clientHeight >= 2);`);
  const service='extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts';
  replace(service, '  private performResize() {', `  private performResize() {
    if ((this as any)._risproResizeFrame) return;
    (this as any)._risproResizeFrame = requestAnimationFrame(() => {
      (this as any)._risproResizeFrame = null;
      if (this.renderingEngine && !this.renderingEngine.hasBeenDestroyed && !(this.renderingEngine as any)._risproRenderingBlocked) this.performValidResize();
    });
  }
  private performValidResize() {`);
  replace(service, '      const viewports = this.getRenderingEngine().getViewports();', `      const viewports = this.renderingEngine.getViewports().filter(v => v.element.isConnected && v.element.clientWidth >= 2 && v.element.clientHeight >= 2);
      if (!viewports.length) return;
      this.beforeResizePositionPresentations.clear();`);
  replace(service, '      renderingEngine.resize(isImmediate);\n      renderingEngine.render();\n    } catch (e)', '      renderingEngine.render();\n    } catch (e)');
  replace(service, '  public destroy() {', `  public destroy() {
    cancelAnimationFrame((this as any)._risproResizeFrame);
    (this as any)._risproResizeFrame = null;`);
  replace('extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx', "        if (obsolete || error?.name === 'AbortError') return;", `        if (obsolete || error?.name === 'AbortError') return;
        if (['context-pool-missing','rendering-mode-mismatch','engine-destroyed','context-lost','shader-failed','gpu-allocation-failed'].includes(error?.code)) return;`);
  // 36.1.0 guards compilation, cached binding and the downstream draw. Throw a
  // typed failure here so Cornerstone never marks a failed shader as RENDERED.
  configureVolumeShaderGuard(replace);
  const program='node_modules/@kitware/vtk.js/Rendering/OpenGL/ShaderProgram.js';
  for (const stage of ['vertex','fragment']) {
    const anchor=`      vtkErrorMacro(model.${stage}Shader.getError());`;
    replace(program,anchor,anchor+`
      document.dispatchEvent(new CustomEvent('rispro-rendering-failure', { detail: {
        engineId: model.context?.canvas?.risproRenderingEngineId, code: 'shader-failed', shaderStage: '${stage}',
        shaderLog: String(model.${stage}Shader.getError()).slice(0, 1000), contextLost: !!model.context?.isContextLost()
      } }));`);
  }
  replace(program,'      vtkErrorMacro(`Links failed: ${model.error}`);', '      vtkErrorMacro(`Links failed: ${model.error}`);'+`
      document.dispatchEvent(new CustomEvent('rispro-rendering-failure', { detail: {
        engineId: model.context?.canvas?.risproRenderingEngineId, code: 'shader-failed', shaderStage: 'link',
        shaderLog: String(model.error).slice(0, 1000), contextLost: !!model.context?.isContextLost()
      } }));`);
  // Cleanup all local actors on cancellation/rejection, including actors built
  // before the final await. Never delete a cache-owned texture or image volume.
  const volume=core+'BaseVolumeViewport.js';
  replace(volume, '        const volumeActors = [];\n        for (let i = 0; i < volumeInputArray.length; i++) {', `        const volumeActors = [];
        const release = actor => { actor?.getMapper?.()?.delete?.(); actor?.delete?.(); if (actor) globalThis.risproRenderingResources.discardedActors++; };
        try {
        for (let i = 0; i < volumeInputArray.length; i++) {`);
  replace(volume, '            if (this._risproSelection !== selection || this.isDisabled) { actor?.delete?.(); return; }',
    '            if (this._risproSelection !== selection || this.isDisabled) { release(actor); volumeActors.forEach(entry => release(entry.actor)); return; }');
  replace(volume, '        this._setVolumeActors(volumeActors);', `        } catch (error) { volumeActors.forEach(entry => release(entry.actor)); throw error; }
        this._risproVolumeInputs = volumeInputArray;
        this._setVolumeActors(volumeActors);`);
  const actor=core+'helpers/createVolumeActor.js';
  replace(actor, '    const volumeActor = vtkVolume.newInstance();', `    const volumeActor = vtkVolume.newInstance();
    globalThis.risproRenderingResources ||= { createdActors: 0, discardedActors: 0 };
    globalThis.risproRenderingResources.createdActors++;`);
  replace(actor, '    await setDefaultVolumeVOI(volumeActor, imageVolume);', '    try {\n    await setDefaultVolumeVOI(volumeActor, imageVolume);');
  replace(actor, '    return volumeActor;', `    return volumeActor;
    } catch (error) { volumeMapper.delete(); volumeActor.delete(); globalThis.risproRenderingResources.discardedActors++; throw error; }`);
}
module.exports = { configureRenderingResilience, configureVolumeShaderGuard };
if (require.main === module) configureRenderingResilience(process.cwd());
