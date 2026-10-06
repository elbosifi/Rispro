import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { TeachingAnatomyManifest, TeachingAnatomyStructure } from "../api/teaching-api";
import { fetchTeachingAnatomyAtlasAsset } from "../api/teaching-api";
import { anatomyStructureMeshGroup, canRenderAnatomyStructure, isAnatomyStructureVisible, isInAnatomyStructureSubtree } from "./anatomy-structure-mesh-selection";
import { anatomyPlaneWorldTransformAtPoint, type AnatomyNrrdGeometry, type AnatomyPlane } from "./anatomy-nrrd";

interface Anatomy3dViewerProps {
  manifest: TeachingAnatomyManifest;
  geometry: AnatomyNrrdGeometry | null;
  worldPointLps: [number, number, number] | null;
  sectionPlanesVisible: boolean;
  selectedStructureId: string | null;
  hiddenStructureIds: string[];
  isolatedStructureId: string | null;
  onSelectStructure: (structureId: string) => void;
}

interface ViewerStatus { loading: boolean; error: string | null }

const LAZY_MESH_THRESHOLD = 40;
const MAX_LAZY_DETAIL_OBJECTS = 12;
const MAX_LAZY_DETAIL_BYTES = 32 * 1024 * 1024;

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
    if (structure.id === "overview") {
      const applyOverviewIds = (node: THREE.Object3D, inheritedId: string | null = null) => {
        const marker = node.name.match(/^RISPRO_STRUCTURE_ID_([a-z0-9][a-z0-9-]{0,79})$/i)?.[1];
        const structureId = marker ?? inheritedId;
        if (structureId) node.userData.structureId = structureId;
        for (const child of node.children) applyOverviewIds(child, structureId);
      };
      applyOverviewIds(object);
    }
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
      if (structure.id !== "overview" || typeof child.userData.structureId !== "string") child.userData.structureId = structure.id;
      child.geometry.computeVertexNormals();
    }
  });
  return object;
}

function updateOverviewStyle(object: THREE.Object3D, selectedStructureId: string | null, structuresById: Map<string, TeachingAnatomyStructure>): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || typeof child.userData.structureId !== "string") return;
    const material = child.material as THREE.MeshStandardMaterial;
    const selected = selectedStructureId !== null && isInAnatomyStructureSubtree(child.userData.structureId, selectedStructureId, structuresById);
    material.emissive.set(selected ? "#fff3a3" : "#000000");
    material.emissiveIntensity = selected ? 0.85 : 0;
    material.opacity = selectedStructureId ? selected ? 0.82 : 0.22 : 0.42;
    material.transparent = true;
    material.needsUpdate = true;
  });
}

function updateOverviewVisibility(object: THREE.Object3D, hiddenStructureIds: string[], isolatedStructureId: string | null, structuresById: Map<string, TeachingAnatomyStructure>): void {
  object.visible = !isolatedStructureId;
  object.traverse((child) => {
    if (typeof child.userData.structureId !== "string" || child.userData.structureId === "overview") return;
    child.visible = isAnatomyStructureVisible(child.userData.structureId, hiddenStructureIds, isolatedStructureId, structuresById);
  });
}

function updateStructureStyle(object: THREE.Object3D, structureId: string, selectedStructureId: string | null, structuresById: Map<string, TeachingAnatomyStructure>): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    const selected = selectedStructureId !== null && isInAnatomyStructureSubtree(structureId, selectedStructureId, structuresById);
    material.emissive.set(selected ? "#fff3a3" : "#000000");
    material.emissiveIntensity = selected ? 0.85 : 0;
    material.opacity = selectedStructureId && !selected ? 0.76 : 1;
    material.transparent = Boolean(selectedStructureId && !selected);
    material.needsUpdate = true;
  });
}

function positionSectionPlane(mesh: THREE.Mesh, geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, worldPointLps: [number, number, number]): void {
  const transform = anatomyPlaneWorldTransformAtPoint(geometry, plane, worldPointLps);
  const horizontal = new THREE.Vector3(...transform.horizontal).normalize();
  const vertical = new THREE.Vector3(...transform.vertical).normalize();
  const normal = new THREE.Vector3(...transform.normal).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(horizontal, vertical, normal));
  mesh.position.set(...transform.point);
}

export function Anatomy3dViewer({ manifest, geometry, worldPointLps, sectionPlanesVisible, selectedStructureId, hiddenStructureIds, isolatedStructureId, onSelectStructure }: Anatomy3dViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const resetCameraRef = useRef<() => void>(() => undefined);
  const overviewCameraResetRef = useRef<(() => void) | null>(null);
  const fitCameraRef = useRef<(bounds: THREE.Box3) => void>(() => undefined);
  const objectsRef = useRef(new Map<string, THREE.Object3D>());
  const sectionPlanesRef = useRef(new Map<AnatomyPlane, THREE.Mesh>());
  const overviewRef = useRef<THREE.Object3D | null>(null);
  const loadSelectedRef = useRef<((structureId: string | null) => void) | null>(null);
  const requestRenderRef = useRef<() => void>(() => undefined);
  const worldPointRef = useRef(worldPointLps);
  const sectionPlanesVisibleRef = useRef(sectionPlanesVisible);
  const selectedStructureRef = useRef(selectedStructureId);
  const hiddenStructureIdsRef = useRef(hiddenStructureIds);
  const isolatedStructureIdRef = useRef(isolatedStructureId);
  worldPointRef.current = worldPointLps;
  sectionPlanesVisibleRef.current = sectionPlanesVisible;
  selectedStructureRef.current = selectedStructureId;
  hiddenStructureIdsRef.current = hiddenStructureIds;
  isolatedStructureIdRef.current = isolatedStructureId;
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, error: null });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const objects = objectsRef.current;
    const sectionPlanes = sectionPlanesRef.current;
    const detailOrder: string[] = [];
    const detailSizes = new Map<string, number>();
    const protectedDetailIds = new Set<string>();
    objects.clear();
    sectionPlanes.clear();
    overviewRef.current = null;
    let disposed = false;
    let animationFrame = 0;
    let controls: OrbitControls | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let requestRender: () => void = () => undefined;
    let removeRenderListeners: (() => void) | null = null;
    let removeControlsChangeListener: (() => void) | null = null;
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

    const trimLazyDetails = () => {
      let retainedBytes = [...detailSizes.values()].reduce((total, bytes) => total + bytes, 0);
      while ((objects.size > MAX_LAZY_DETAIL_OBJECTS || retainedBytes > MAX_LAZY_DETAIL_BYTES) && detailOrder.length > 0) {
        const evictIndex = detailOrder.findIndex((id) => !protectedDetailIds.has(id));
        if (evictIndex < 0) break;
        const [evictedId] = detailOrder.splice(evictIndex, 1);
        const evicted = objects.get(evictedId!);
        if (evicted) { anatomyGroup.remove(evicted); disposeObject(evicted); objects.delete(evictedId!); }
        retainedBytes -= detailSizes.get(evictedId!) ?? 0;
        detailSizes.delete(evictedId!);
      }
    };

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

    requestRender = () => {
      if (disposed || !renderer || animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (disposed || !renderer) return;
        controls?.update();
        renderer.render(scene, camera);
      });
    };
    requestRenderRef.current = requestRender;
    const onControlsChange = () => requestRender();
    controls.addEventListener("change", onControlsChange);
    removeControlsChangeListener = () => controls?.removeEventListener("change", onControlsChange);
    const onCanvasInteraction = () => requestRender();
    for (const eventName of ["pointerdown", "pointermove", "wheel"]) renderer.domElement.addEventListener(eventName, onCanvasInteraction);
    removeRenderListeners = () => {
      for (const eventName of ["pointerdown", "pointermove", "wheel"]) renderer?.domElement.removeEventListener(eventName, onCanvasInteraction);
    };

    const sizeRenderer = () => {
      if (!renderer || !host.clientWidth || !host.clientHeight) return;
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const resizeObserver = new ResizeObserver(sizeRenderer);
    resizeObserver.observe(host);
    sizeRenderer();
    requestRender();

    const meshStructures = manifest.structures.filter((structure) => structure.meshAsset);
    const selectableStructureIds = new Set(manifest.structures.map(({ id }) => id));
    const structuresById = new Map(manifest.structures.map((structure) => [structure.id, structure]));
    const lazyLoad = meshStructures.length > LAZY_MESH_THRESHOLD;
    const fitCamera = (fullBounds: THREE.Box3) => {
      if (fullBounds.isEmpty()) return () => undefined;
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
        requestRender();
      };
      resetCameraRef.current = reset;
      reset();
      return reset;
    };
    fitCameraRef.current = fitCamera;

    if (geometry) {
      const point = worldPointRef.current ?? [0, 0, 0];
      const planeColors: Array<[AnatomyPlane, string]> = [["axial", "#38bdf8"], ["sagittal", "#f472b6"], ["coronal", "#a3e635"]];
      for (const [section, color] of planeColors) {
        const transform = anatomyPlaneWorldTransformAtPoint(geometry, section, point);
        const sectionMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(transform.width * transform.spacingX, transform.height * transform.spacingY),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
        );
        sectionMesh.userData.isSlicePlane = true;
        sectionMesh.visible = sectionPlanesVisibleRef.current;
        planeGroup.add(sectionMesh);
        sectionPlanes.set(section, sectionMesh);
        positionSectionPlane(sectionMesh, geometry, section, point);
      }
      fitCamera(volumeBounds(geometry));
    }

    loadSelectedRef.current = (structureId: string | null) => {
      if (!lazyLoad || disposed) return;
      selectedAbortController?.abort();
      selectedAbortController = null;
      const generation = ++selectionGeneration;
      protectedDetailIds.clear();
      if (!structureId) {
        trimLazyDetails();
        setStatus({ loading: false, error: null });
        requestRender();
        return;
      }
      const structures = anatomyStructureMeshGroup(manifest, structureId);
      if (structures.length === 0) {
        trimLazyDetails();
        setStatus({ loading: false, error: null });
        return;
      }
      for (const structure of structures) protectedDetailIds.add(structure.id);
      trimLazyDetails();
      for (const structure of structures) {
        const cachedObject = objects.get(structure.id);
        if (!cachedObject) continue;
        cachedObject.visible = isAnatomyStructureVisible(structure.id, hiddenStructureIdsRef.current, isolatedStructureIdRef.current, structuresById);
        updateStructureStyle(cachedObject, structure.id, selectedStructureRef.current, structuresById);
      }
      const missing = structures.filter((structure) => !objects.has(structure.id));
      if (missing.length === 0) {
        host.dataset.selectedGeometryStructureIds = structures.map(({ id }) => id).join(",");
        if (!geometry && isolatedStructureIdRef.current === structureId) {
          const bounds = new THREE.Box3();
          structures.forEach(({ id }) => { const object = objects.get(id); if (object) bounds.expandByObject(object); });
          fitCameraRef.current(bounds);
        }
        setStatus({ loading: false, error: null });
        requestRender();
        return;
      }
      const missingAssets = missing.map((structure) => {
        const asset = manifest.assets[structure.meshAsset!];
        if (!asset || !asset.mediaType.startsWith("model/")) throw new Error(`The atlas manifest does not declare a mesh for ${structure.name}.`);
        return { structure, asset };
      });
      const request = new AbortController();
      selectedAbortController = request;
      setStatus({ loading: true, error: null });
      void Promise.all(missingAssets.map(async ({ structure, asset }) => ({
        structure,
        asset,
        buffer: await fetchTeachingAnatomyAtlasAsset(manifest.atlasId, structure.meshAsset!, request.signal, asset.integrity?.sha256),
      }))).then((loaded) => {
        if (disposed || request.signal.aborted || generation !== selectionGeneration) return;
        const parsed: Array<{ structure: TeachingAnatomyStructure; asset: TeachingAnatomyManifest["assets"][string]; object: THREE.Object3D }> = [];
        try {
          for (const { structure, asset, buffer } of loaded) {
            const selected = selectedStructureRef.current !== null && isInAnatomyStructureSubtree(structure.id, selectedStructureRef.current, structuresById);
            const object = makeStructureObject(buffer, asset.mediaType, asset.file, manifest, structure, selected);
            try {
              if (geometry) validateMeshBounds(object, volumeBounds(geometry), structure, geometry);
            } catch (error) {
              disposeObject(object);
              throw error;
            }
            object.visible = isAnatomyStructureVisible(structure.id, hiddenStructureIdsRef.current, isolatedStructureIdRef.current, structuresById);
            parsed.push({ structure, asset, object });
          }
        } catch (error) {
          parsed.forEach(({ object }) => disposeObject(object));
          throw error;
        }
        for (const { structure, asset, object } of parsed) {
          const previous = objects.get(structure.id);
          if (previous) { anatomyGroup.remove(previous); disposeObject(previous); }
          anatomyGroup.add(object); objects.set(structure.id, object);
          const previousPosition = detailOrder.indexOf(structure.id);
          if (previousPosition >= 0) detailOrder.splice(previousPosition, 1);
          detailOrder.push(structure.id);
          detailSizes.set(structure.id, asset.integrity?.sizeBytes ?? 0);
        }
        trimLazyDetails();
        host.dataset.loadedStructureIds = [...objects.keys()].join(",");
        host.dataset.selectedGeometryStructureIds = structures.map(({ id }) => id).join(",");
        if (!geometry && isolatedStructureIdRef.current === structureId) {
          const bounds = new THREE.Box3();
          structures.forEach(({ id }) => { const object = objects.get(id); if (object) bounds.expandByObject(object); });
          fitCamera(bounds);
        } else if (!geometry && !overviewRef.current) fitCamera(new THREE.Box3().setFromObject(anatomyGroup));
        requestRender();
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
      const structureId = hits.find((hit) => typeof hit.object.userData.structureId === "string" && selectableStructureIds.has(hit.object.userData.structureId))?.object.userData.structureId;
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
        const buffer = await fetchTeachingAnatomyAtlasAsset(manifest.atlasId, structure.meshAsset!, abortController.signal, asset.integrity?.sha256);
        if (disposed) return;
        const object = makeStructureObject(buffer, asset.mediaType, asset.file, manifest, structure, selectedStructureRef.current === structure.id);
        if (geometry) validateMeshBounds(object, volumeBounds(geometry), structure, geometry);
        object.visible = isAnatomyStructureVisible(structure.id, hiddenStructureIdsRef.current, isolatedStructureIdRef.current, structuresById);
        anatomyGroup.add(object);
        objects.set(structure.id, object);
      }
      if (disposed) return;
      host.dataset.loadedStructureIds = [...objects.keys()].join(",");
      const fullBounds = geometry ? volumeBounds(geometry) : new THREE.Box3().setFromObject(anatomyGroup);
      if (fullBounds.isEmpty()) throw new Error("This atlas does not declare any visible 3D mesh structures.");
      if (!geometry) fitCamera(fullBounds);
      requestRender();
      setStatus({ loading: false, error: null });
    };

    const loadOverview = async () => {
      // React Strict Mode immediately cleans up and replays effects in development.
      // Let that discarded setup settle before fetching a large overview asset.
      await Promise.resolve();
      if (disposed || abortController.signal.aborted) return;
      if (!manifest.overviewAsset) return;
      const asset = manifest.assets[manifest.overviewAsset];
      if (!asset) return;
      const overview = makeStructureObject(await fetchTeachingAnatomyAtlasAsset(manifest.atlasId, manifest.overviewAsset, abortController.signal, asset.integrity?.sha256), asset.mediaType, asset.file, manifest, { id: "overview", name: "Whole-body overview", category: "overview", synonyms: [], color: "#9aa7b8", note: "" }, false);
      overview.userData.isOverview = true;
      overviewRef.current = overview;
      overview.traverse((child) => { if (child instanceof THREE.Mesh) { const material = child.material as THREE.MeshStandardMaterial; material.transparent = true; material.opacity = .42; } });
      updateOverviewStyle(overview, selectedStructureRef.current, structuresById);
      updateOverviewVisibility(overview, hiddenStructureIdsRef.current, isolatedStructureIdRef.current, structuresById);
      anatomyGroup.add(overview);
      requestRender();
      host.dataset.wholeBodyOverviewLoaded = "true";
      host.dataset.wholeBodyOverviewVisible = String(overview.visible);
      const overviewStructureIds = new Set<string>();
      overview.traverse((child) => { if (typeof child.userData.structureId === "string" && child.userData.structureId !== "overview") overviewStructureIds.add(child.userData.structureId); });
      host.dataset.wholeBodyOverviewStructureCount = String(overviewStructureIds.size);
      if (!geometry) overviewCameraResetRef.current = fitCamera(new THREE.Box3().setFromObject(anatomyGroup));
    };
    setStatus({ loading: !lazyLoad || Boolean(manifest.overviewAsset), error: null });
    if (!lazyLoad) void fetchAllModels().catch((error: unknown) => {
      if (!disposed) setStatus({ loading: false, error: error instanceof Error ? error.message : "An atlas mesh could not be loaded." });
    });
    else void loadOverview().then(() => { if (!disposed) setStatus({ loading: false, error: null }); }).catch((error: unknown) => { if (!disposed) setStatus({ loading: false, error: error instanceof Error ? error.message : "Whole-body overview could not be loaded." }); });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      requestRenderRef.current = () => undefined;
      resizeObserver.disconnect();
      removeRenderListeners?.();
      removeControlsChangeListener?.();
      removePointerListeners?.();
      controls?.dispose();
      abortController.abort();
      selectedAbortController?.abort();
      loadSelectedRef.current = null;
      sectionPlanes.clear();
      overviewRef.current = null;
      resetCameraRef.current = () => undefined;
      overviewCameraResetRef.current = null;
      fitCameraRef.current = () => undefined;
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
    const structuresById = new Map(manifest.structures.map((structure) => [structure.id, structure]));
    for (const [structureId, object] of objectsRef.current) updateStructureStyle(object, structureId, selectedStructureId, structuresById);
    if (overviewRef.current) updateOverviewStyle(overviewRef.current, selectedStructureId, structuresById);
    requestRenderRef.current();
  }, [manifest, selectedStructureId]);

  useEffect(() => {
    const structuresById = new Map(manifest.structures.map((structure) => [structure.id, structure]));
    for (const [structureId, object] of objectsRef.current) {
      object.visible = isAnatomyStructureVisible(structureId, hiddenStructureIds, isolatedStructureId, structuresById);
    }
    if (overviewRef.current) updateOverviewVisibility(overviewRef.current, hiddenStructureIds, isolatedStructureId, structuresById);
    if (hostRef.current && overviewRef.current) hostRef.current.dataset.wholeBodyOverviewVisible = String(overviewRef.current.visible);
    if (isolatedStructureId) {
      const bounds = new THREE.Box3();
      for (const [structureId, object] of objectsRef.current) {
        if (isInAnatomyStructureSubtree(structureId, isolatedStructureId, structuresById)) bounds.expandByObject(object);
      }
      if (!bounds.isEmpty()) fitCameraRef.current(bounds);
    } else if (overviewCameraResetRef.current) overviewCameraResetRef.current();
    requestRenderRef.current();
  }, [manifest, hiddenStructureIds, isolatedStructureId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const [plane, sectionMesh] of sectionPlanesRef.current) {
      sectionMesh.visible = sectionPlanesVisible;
      if (geometry && worldPointLps) positionSectionPlane(sectionMesh, geometry, plane, worldPointLps);
    }
    host.dataset.sectionPlaneCount = String(sectionPlanesRef.current.size);
    if (geometry && worldPointLps) host.dataset.sectionPlanesWorldPointLps = worldPointLps.join(",");
    host.dataset.sectionPlanesVisible = String(sectionPlanesVisible);
    requestRenderRef.current();
  }, [geometry, worldPointLps, sectionPlanesVisible]);

  const lazyLoad = manifest.structures.filter((structure) => structure.meshAsset).length > LAZY_MESH_THRESHOLD;
  const selectedStructureHasMesh = selectedStructureId ? canRenderAnatomyStructure(manifest, selectedStructureId) : false;

  return (
    <section aria-labelledby="anatomy-3d-title" className="relative flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-xl border bg-[#101827] text-white" style={{ borderColor: "var(--border)" }}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <div><h2 id="anatomy-3d-title" className="text-sm font-semibold">3D anatomy</h2><p className="text-xs text-slate-300">{manifest.coordinateSystem} physical space{geometry ? " - three section planes synchronized" : " - independent whole-body reference"}</p></div>
        <button type="button" className="rounded-md border border-white/20 px-2.5 py-1.5 text-xs hover:bg-white/10" onClick={() => resetCameraRef.current()}>Reset view</button>
      </header>
      <div ref={hostRef} className="relative min-h-[27rem] flex-1 touch-none" aria-label="Interactive 3D anatomy model. Drag to rotate; scroll to zoom; click a structure to select it." />
      {status.loading && <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">Loading atlas structures…</div>}
      {!status.loading && !status.error && selectedStructureId && lazyLoad && !selectedStructureHasMesh && <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">No bounded source-surface group is available for this hierarchy item. Select one of its listed surfaces to view it in 3D.</div>}
      {status.error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded-lg border border-red-400/40 bg-red-950/90 px-3 py-2 text-sm text-red-100">{status.error}</div>}
    </section>
  );
}
