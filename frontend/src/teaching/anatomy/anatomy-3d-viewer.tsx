import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { TeachingAnatomyManifest, TeachingAnatomyStructure } from "../api/teaching-api";
import { fetchTeachingAnatomyAtlasAsset } from "../api/teaching-api";
import { anatomyPlaneWorldTransform, type AnatomyNrrdGeometry, type AnatomyPlane } from "./anatomy-nrrd";

interface Anatomy3dViewerProps {
  manifest: TeachingAnatomyManifest;
  geometry: AnatomyNrrdGeometry | null;
  plane: AnatomyPlane;
  sliceIndex: number;
  selectedStructureId: string | null;
  hiddenStructureIds: string[];
  isolatedStructureId: string | null;
  onSelectStructure: (structureId: string) => void;
}

interface ViewerStatus { loading: boolean; error: string | null }

const LAZY_MESH_THRESHOLD = 40;

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function volumeBounds(geometry: AnatomyNrrdGeometry): THREE.Box3 {
  const box = new THREE.Box3();
  for (const i of [0, geometry.sizes[0] - 1]) for (const j of [0, geometry.sizes[1] - 1]) for (const k of [0, geometry.sizes[2] - 1]) {
    const point = [0, 1, 2].map((axis) => geometry.origin[axis]! + geometry.directions[0][axis]! * i + geometry.directions[1][axis]! * j + geometry.directions[2][axis]! * k);
    box.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]));
  }
  return box;
}

function validateMeshBounds(object: THREE.Object3D, bounds: THREE.Box3, structure: TeachingAnatomyStructure, geometry: AnatomyNrrdGeometry): void {
  const meshBounds = new THREE.Box3().setFromObject(object);
  const tolerance = Math.max(...geometry.directions.map((direction) => Math.hypot(...direction))) * 2;
  if (!bounds.clone().expandByScalar(tolerance).containsBox(meshBounds)) {
    throw new Error(`${structure.name} does not occupy the declared atlas physical bounds. Check the installed mesh coordinate system.`);
  }
}

function createMaterial(structure: TeachingAnatomyStructure, selected: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: structure.color, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide });
  if (selected) {
    material.emissive.set("#fff3a3");
    material.emissiveIntensity = 0.85;
  }
  return material;
}

function makeStructureObject(buffer: ArrayBuffer, mediaType: string, filename: string, manifest: TeachingAnatomyManifest, structure: TeachingAnatomyStructure, selected: boolean): THREE.Object3D {
  let object: THREE.Object3D;
  if (mediaType === "model/stl" || filename.toLowerCase().endsWith(".stl")) {
    const geometry = new STLLoader().parse(buffer);
    if (manifest.meshCoordinateSystem !== manifest.coordinateSystem) geometry.applyMatrix4(new THREE.Matrix4().makeScale(-1, -1, 1));
    object = new THREE.Mesh(geometry, createMaterial(structure, selected));
  } else if (mediaType === "model/obj" || filename.toLowerCase().endsWith(".obj")) {
    object = new OBJLoader().parse(new TextDecoder().decode(buffer));
    if (manifest.meshCoordinateSystem !== manifest.coordinateSystem) object.scale.set(-1, -1, 1);
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const oldMaterials = Array.isArray(child.material) ? child.material : [child.material];
      oldMaterials.forEach((material) => material.dispose());
      child.material = createMaterial(structure, selected);
    });
  } else {
    throw new Error(`The 3D viewer does not support ${mediaType} for ${structure.name}.`);
  }
  object.userData.structureId = structure.id;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.userData.structureId = structure.id;
      child.geometry.computeVertexNormals();
    }
  });
  return object;
}

function updateStructureStyle(object: THREE.Object3D, structureId: string, selectedStructureId: string | null): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    const selected = structureId === selectedStructureId;
    material.emissive.set(selected ? "#fff3a3" : "#000000");
    material.emissiveIntensity = selected ? 0.85 : 0;
    material.opacity = selectedStructureId && !selected ? 0.76 : 1;
    material.transparent = Boolean(selectedStructureId && !selected);
    material.needsUpdate = true;
  });
}

function positionSlicePlane(mesh: THREE.Mesh, geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, sliceIndex: number): void {
  const transform = anatomyPlaneWorldTransform(geometry, plane, sliceIndex);
  mesh.geometry.dispose();
  mesh.geometry = new THREE.PlaneGeometry(transform.width * transform.spacingX, transform.height * transform.spacingY);
  const horizontal = new THREE.Vector3(...transform.horizontal).normalize();
  const vertical = new THREE.Vector3(...transform.vertical).normalize();
  const normal = new THREE.Vector3(...transform.normal).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(horizontal, vertical, normal));
  mesh.position.set(...transform.point);
}

export function Anatomy3dViewer({ manifest, geometry, plane, sliceIndex, selectedStructureId, hiddenStructureIds, isolatedStructureId, onSelectStructure }: Anatomy3dViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const resetCameraRef = useRef<() => void>(() => undefined);
  const objectsRef = useRef(new Map<string, THREE.Object3D>());
  const slicePlaneRef = useRef<THREE.Mesh | null>(null);
  const loadSelectedRef = useRef<((structureId: string | null) => void) | null>(null);
  const sliceIndexRef = useRef(sliceIndex);
  const planeRef = useRef(plane);
  const selectedStructureRef = useRef(selectedStructureId);
  const hiddenStructureIdsRef = useRef(hiddenStructureIds);
  const isolatedStructureIdRef = useRef(isolatedStructureId);
  sliceIndexRef.current = sliceIndex;
  planeRef.current = plane;
  selectedStructureRef.current = selectedStructureId;
  hiddenStructureIdsRef.current = hiddenStructureIds;
  isolatedStructureIdRef.current = isolatedStructureId;
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, error: null });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const objects = objectsRef.current;
    objects.clear();
    let disposed = false;
    let animationFrame = 0;
    let controls: OrbitControls | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    const abortController = new AbortController();
    let selectedAbortController: AbortController | null = null;
    let selectionGeneration = 0;
    let removePointerListeners: (() => void) | null = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101827");
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100_000);
    camera.up.set(0, 0, 1);
    const anatomyGroup = new THREE.Group();
    const planeGroup = new THREE.Group();
    scene.add(anatomyGroup, planeGroup);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x263244, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(-1, -1, 2);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x94b8ff, 0.8);
    fillLight.position.set(1, 1, 1);
    scene.add(fillLight);

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.replaceChildren(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
    } catch {
      setStatus({ loading: false, error: "WebGL is unavailable in this browser. Enable hardware graphics acceleration to view the 3D atlas." });
      return;
    }

    const sizeRenderer = () => {
      if (!renderer || !host.clientWidth || !host.clientHeight) return;
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(sizeRenderer);
    resizeObserver.observe(host);
    sizeRenderer();
    animationFrame = requestAnimationFrame(function draw() {
      if (disposed || !renderer) return;
      controls?.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(draw);
    });

    const meshStructures = manifest.structures.filter((structure) => structure.meshAsset);
    const lazyLoad = meshStructures.length > LAZY_MESH_THRESHOLD;
    const fitCamera = (fullBounds: THREE.Box3) => {
      if (fullBounds.isEmpty()) return;
      const center = fullBounds.getCenter(new THREE.Vector3());
      const extent = fullBounds.getSize(new THREE.Vector3());
      const largestExtent = Math.max(extent.x, extent.y, extent.z);
      const distance = Math.max(largestExtent * 1.65, 100);
      const reset = () => {
        camera.position.set(center.x + distance * 0.9, center.y - distance * 1.3, center.z + distance * 1.0);
        camera.near = Math.max(0.1, largestExtent / 1000);
        camera.far = distance * 12;
        camera.updateProjectionMatrix();
        controls?.target.copy(center);
        controls?.update();
      };
      resetCameraRef.current = reset;
      reset();
    };

    if (geometry) {
      const transform = anatomyPlaneWorldTransform(geometry, planeRef.current, sliceIndexRef.current);
      const planeGeometry = new THREE.PlaneGeometry(transform.width * transform.spacingX, transform.height * transform.spacingY);
      const planeMaterial = new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
      const slicePlane = new THREE.Mesh(planeGeometry, planeMaterial);
      slicePlane.userData.isSlicePlane = true;
      planeGroup.add(slicePlane);
      slicePlaneRef.current = slicePlane;
      positionSlicePlane(slicePlane, geometry, planeRef.current, sliceIndexRef.current);
      fitCamera(volumeBounds(geometry));
    }

    const clearLoadedObjects = () => {
      for (const object of [...anatomyGroup.children]) {
        anatomyGroup.remove(object);
        disposeObject(object);
      }
      objects.clear();
    };

    loadSelectedRef.current = (structureId: string | null) => {
      if (!lazyLoad || disposed) return;
      selectedAbortController?.abort();
      selectedAbortController = null;
      const generation = ++selectionGeneration;
      clearLoadedObjects();
      if (!structureId) {
        setStatus({ loading: false, error: null });
        return;
      }
      const structure = manifest.structures.find((entry) => entry.id === structureId);
      if (!structure?.meshAsset) {
        setStatus({ loading: false, error: null });
        return;
      }
      const asset = manifest.assets[structure.meshAsset];
      if (!asset || !asset.mediaType.startsWith("model/")) {
        setStatus({ loading: false, error: `The atlas manifest does not declare a mesh for ${structure.name}.` });
        return;
      }
      const request = new AbortController();
      selectedAbortController = request;
      setStatus({ loading: true, error: null });
      void fetchTeachingAnatomyAtlasAsset(manifest.atlasId, structure.meshAsset, request.signal).then((buffer) => {
        if (disposed || request.signal.aborted || generation !== selectionGeneration) return;
        const object = makeStructureObject(buffer, asset.mediaType, asset.file, manifest, structure, selectedStructureRef.current === structure.id);
        try {
          if (geometry) validateMeshBounds(object, volumeBounds(geometry), structure, geometry);
        } catch (error) {
          disposeObject(object);
          throw error;
        }
        object.visible = !hiddenStructureIdsRef.current.includes(structure.id) && (!isolatedStructureIdRef.current || isolatedStructureIdRef.current === structure.id);
        anatomyGroup.add(object);
        objects.set(structure.id, object);
        if (!geometry) fitCamera(new THREE.Box3().setFromObject(object));
        setStatus({ loading: false, error: null });
      }).catch((error: unknown) => {
        if (disposed || request.signal.aborted || generation !== selectionGeneration) return;
        setStatus({ loading: false, error: error instanceof Error ? error.message : "An atlas mesh could not be loaded." });
      });
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPoint: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => { downPoint = { x: event.clientX, y: event.clientY }; };
    const onPointerCancel = () => { downPoint = null; };
    const onPointerUp = (event: PointerEvent) => {
      if (!downPoint || Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) > 5) { downPoint = null; return; }
      downPoint = null;
      const rect = renderer!.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(anatomyGroup.children, true);
      const structureId = hits.find((hit) => typeof hit.object.userData.structureId === "string")?.object.userData.structureId;
      if (typeof structureId === "string") onSelectStructure(structureId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    removePointerListeners = () => {
      renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer?.domElement.removeEventListener("pointerup", onPointerUp);
      renderer?.domElement.removeEventListener("pointercancel", onPointerCancel);
    };

    const fetchAllModels = async () => {
      for (const structure of meshStructures) {
        if (abortController.signal.aborted) return;
        const asset = manifest.assets[structure.meshAsset!];
        if (!asset || !asset.mediaType.startsWith("model/")) throw new Error(`The atlas manifest does not declare a mesh for ${structure.name}.`);
        const buffer = await fetchTeachingAnatomyAtlasAsset(manifest.atlasId, structure.meshAsset!, abortController.signal);
        if (disposed) return;
        const object = makeStructureObject(buffer, asset.mediaType, asset.file, manifest, structure, selectedStructureRef.current === structure.id);
        if (geometry) validateMeshBounds(object, volumeBounds(geometry), structure, geometry);
        object.visible = !hiddenStructureIdsRef.current.includes(structure.id) && (!isolatedStructureIdRef.current || isolatedStructureIdRef.current === structure.id);
        anatomyGroup.add(object);
        objects.set(structure.id, object);
      }
      if (disposed) return;
      const fullBounds = geometry ? volumeBounds(geometry) : new THREE.Box3().setFromObject(anatomyGroup);
      if (fullBounds.isEmpty()) throw new Error("This atlas does not declare any visible 3D mesh structures.");
      if (!geometry) fitCamera(fullBounds);
      renderer?.render(scene, camera);
      setStatus({ loading: false, error: null });
    };

    setStatus({ loading: !lazyLoad, error: null });
    if (!lazyLoad) void fetchAllModels().catch((error: unknown) => {
      if (!disposed) setStatus({ loading: false, error: error instanceof Error ? error.message : "An atlas mesh could not be loaded." });
    });
    else setStatus({ loading: false, error: null });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      removePointerListeners?.();
      controls?.dispose();
      abortController.abort();
      selectedAbortController?.abort();
      loadSelectedRef.current = null;
      slicePlaneRef.current = null;
      resetCameraRef.current = () => undefined;
      objects.clear();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [manifest, geometry, onSelectStructure]);

  useEffect(() => {
    loadSelectedRef.current?.(selectedStructureId);
  }, [manifest, selectedStructureId]);

  useEffect(() => {
    for (const [structureId, object] of objectsRef.current) updateStructureStyle(object, structureId, selectedStructureId);
  }, [selectedStructureId]);

  useEffect(() => {
    for (const [structureId, object] of objectsRef.current) {
      object.visible = !hiddenStructureIds.includes(structureId) && (!isolatedStructureId || isolatedStructureId === structureId);
    }
  }, [hiddenStructureIds, isolatedStructureId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.dataset.sliceIndex = String(sliceIndex);
    host.dataset.slicePlane = plane;
    if (!geometry) return;
    const transform = anatomyPlaneWorldTransform(geometry, plane, sliceIndex);
    host.dataset.sliceWorldOrigin = transform.point.join(",");
    const slicePlane = slicePlaneRef.current;
    if (slicePlane) positionSlicePlane(slicePlane, geometry, plane, sliceIndex);
  }, [geometry, plane, sliceIndex]);

  const lazyLoad = manifest.structures.filter((structure) => structure.meshAsset).length > LAZY_MESH_THRESHOLD;
  const selectedStructureHasMesh = Boolean(manifest.structures.find((structure) => structure.id === selectedStructureId)?.meshAsset);

  return (
    <section aria-labelledby="anatomy-3d-title" className="relative flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-xl border bg-[#101827] text-white" style={{ borderColor: "var(--border)" }}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <div><h2 id="anatomy-3d-title" className="text-sm font-semibold">3D anatomy</h2><p className="text-xs text-slate-300">{manifest.coordinateSystem} physical space{geometry ? ` · ${plane} plane synchronized` : " · regional image not registered"}</p></div>
        <button type="button" className="rounded-md border border-white/20 px-2.5 py-1.5 text-xs hover:bg-white/10" onClick={() => resetCameraRef.current()}>Reset view</button>
      </header>
      <div ref={hostRef} className="relative min-h-[27rem] flex-1 touch-none" aria-label="Interactive 3D anatomy model. Drag to rotate; scroll to zoom; click a structure to select it." />
      {status.loading && <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">Loading atlas structures…</div>}
      {!status.loading && !status.error && lazyLoad && !selectedStructureHasMesh && <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">Select a surface in the structure list to load it in 3D.</div>}
      {status.error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded-lg border border-red-400/40 bg-red-950/90 px-3 py-2 text-sm text-red-100">{status.error}</div>}
    </section>
  );
}
