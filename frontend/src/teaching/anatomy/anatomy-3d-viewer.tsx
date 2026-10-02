import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { TeachingAnatomyManifest, TeachingAnatomyStructure } from "../api/teaching-api";
import { fetchTeachingAnatomyAsset } from "../api/teaching-api";
import { sliceIndexWorldPlane, type AnatomyNrrdGeometry } from "./anatomy-nrrd";

interface Anatomy3dViewerProps {
  manifest: TeachingAnatomyManifest;
  geometry: AnatomyNrrdGeometry;
  sliceIndex: number;
  selectedStructureId: string | null;
  onSelectStructure: (structureId: string) => void;
}

interface ViewerStatus {
  loading: boolean;
  error: string | null;
}

function volumeBounds(geometry: AnatomyNrrdGeometry): THREE.Box3 {
  const box = new THREE.Box3();
  for (const i of [0, geometry.sizes[0] - 1]) for (const j of [0, geometry.sizes[1] - 1]) for (const k of [0, geometry.sizes[2] - 1]) {
    const point = [0, 1, 2].map((axis) => geometry.origin[axis]! + geometry.directions[0][axis]! * i + geometry.directions[1][axis]! * j + geometry.directions[2][axis]! * k);
    box.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]));
  }
  return box;
}

function validateMeshBounds(mesh: THREE.Mesh, bounds: THREE.Box3, structure: TeachingAnatomyStructure, geometry: AnatomyNrrdGeometry): void {
  const meshBounds = new THREE.Box3().setFromObject(mesh);
  const tolerance = Math.max(...geometry.directions.map((direction) => Math.hypot(...direction))) * 2;
  if (!bounds.clone().expandByScalar(tolerance).containsBox(meshBounds)) {
    throw new Error(`${structure.name} does not occupy the declared atlas physical bounds. Check the installed STL coordinate system.`);
  }
}

function positionSlicePlane(plane: THREE.Mesh, geometry: AnatomyNrrdGeometry, sliceIndex: number): void {
  const slice = sliceIndexWorldPlane(geometry, sliceIndex);
  const [xDirection, yDirection] = geometry.directions;
  const xAxis = new THREE.Vector3(...xDirection).normalize();
  const normal = new THREE.Vector3(...slice.normal).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();
  if (yAxis.dot(new THREE.Vector3(...yDirection)) < 0) yAxis.negate();
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, normal));
  plane.position.set(
    slice.point[0] + xDirection[0] * (geometry.sizes[0] - 1) / 2 + yDirection[0] * (geometry.sizes[1] - 1) / 2,
    slice.point[1] + xDirection[1] * (geometry.sizes[0] - 1) / 2 + yDirection[1] * (geometry.sizes[1] - 1) / 2,
    slice.point[2] + xDirection[2] * (geometry.sizes[0] - 1) / 2 + yDirection[2] * (geometry.sizes[1] - 1) / 2,
  );
}

export function Anatomy3dViewer({ manifest, geometry, sliceIndex, selectedStructureId, onSelectStructure }: Anatomy3dViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const resetCameraRef = useRef<() => void>(() => undefined);
  const meshesRef = useRef(new Map<string, THREE.Mesh>());
  const slicePlaneRef = useRef<THREE.Mesh | null>(null);
  const sliceIndexRef = useRef(sliceIndex);
  const selectedStructureRef = useRef(selectedStructureId);
  sliceIndexRef.current = sliceIndex;
  selectedStructureRef.current = selectedStructureId;
  const [status, setStatus] = useState<ViewerStatus>({ loading: true, error: null });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const meshes = meshesRef.current;
    meshes.clear();
    let disposed = false;
    let animationFrame = 0;
    let controls: OrbitControls | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    const abortController = new AbortController();
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
      controlsRef.current = controls;
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

    const fetchModels = async () => {
      const loader = new STLLoader();
      for (const structure of manifest.structures) {
        const asset = manifest.assets[structure.meshAsset];
        if (!asset || asset.mediaType !== "model/stl") throw new Error(`The atlas manifest does not declare a mesh for ${structure.name}.`);
        const buffer = await fetchTeachingAnatomyAsset(structure.meshAsset, abortController.signal);
        if (disposed) return;
        const meshGeometry = loader.parse(buffer);
        meshGeometry.computeVertexNormals();
        if (manifest.meshCoordinateSystem !== manifest.coordinateSystem) {
          meshGeometry.applyMatrix4(new THREE.Matrix4().makeScale(-1, -1, 1));
          meshGeometry.computeVertexNormals();
        }
        const material = new THREE.MeshStandardMaterial({ color: structure.color, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide });
        if (selectedStructureRef.current === structure.id) {
          material.emissive.set("#fff3a3");
          material.emissiveIntensity = 0.85;
        }
        const mesh = new THREE.Mesh(meshGeometry, material);
        mesh.userData.structureId = structure.id;
        validateMeshBounds(mesh, volumeBounds(geometry), structure, geometry);
        anatomyGroup.add(mesh);
        meshes.set(structure.id, mesh);
      }

      const fullBounds = volumeBounds(geometry);
      const center = fullBounds.getCenter(new THREE.Vector3());
      const extent = fullBounds.getSize(new THREE.Vector3());
      const largestExtent = Math.max(extent.x, extent.y, extent.z);
      const distance = Math.max(largestExtent * 1.65, 100);
      const planeGeometry = new THREE.PlaneGeometry(geometry.sizes[0] * Math.hypot(...geometry.directions[0]), geometry.sizes[1] * Math.hypot(...geometry.directions[1]));
      const planeMaterial = new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
      const slicePlane = new THREE.Mesh(planeGeometry, planeMaterial);
      slicePlane.userData.isSlicePlane = true;
      planeGroup.add(slicePlane);
      slicePlaneRef.current = slicePlane;
      positionSlicePlane(slicePlane, geometry, sliceIndexRef.current);
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
      renderer?.render(scene, camera);

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
        const hits = raycaster.intersectObjects(anatomyGroup.children, false);
        const structureId = hits[0]?.object.userData.structureId;
        if (typeof structureId === "string") onSelectStructure(structureId);
      };
      renderer!.domElement.addEventListener("pointerdown", onPointerDown);
      renderer!.domElement.addEventListener("pointerup", onPointerUp);
      renderer!.domElement.addEventListener("pointercancel", onPointerCancel);
      removePointerListeners = () => {
        renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer?.domElement.removeEventListener("pointerup", onPointerUp);
        renderer?.domElement.removeEventListener("pointercancel", onPointerCancel);
      };
      setStatus({ loading: false, error: null });
    };

    setStatus({ loading: true, error: null });
    void fetchModels().catch((error: unknown) => {
      if (!disposed) setStatus({ loading: false, error: error instanceof Error ? error.message : "An atlas mesh could not be loaded." });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      removePointerListeners?.();
      controls?.dispose();
      controlsRef.current = null;
      abortController.abort();
      slicePlaneRef.current = null;
      resetCameraRef.current = () => undefined;
      meshes.clear();
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
    const mesh = meshesRef.current.get(selectedStructureId ?? "");
    for (const [structureId, candidate] of meshesRef.current) {
      const material = candidate.material as THREE.MeshStandardMaterial;
      const selected = structureId === selectedStructureId;
      material.emissive.set(selected ? "#fff3a3" : "#000000");
      material.emissiveIntensity = selected ? 0.85 : 0;
      material.opacity = selectedStructureId && !selected ? 0.76 : 1;
      material.transparent = Boolean(selectedStructureId && !selected);
      material.needsUpdate = true;
    }
    if (mesh) mesh.renderOrder = 2;
  }, [selectedStructureId]);

  useEffect(() => {
    const worldPlane = sliceIndexWorldPlane(geometry, sliceIndex);
    const host = hostRef.current;
    if (host) {
      host.dataset.sliceIndex = String(sliceIndex);
      host.dataset.sliceWorldOrigin = worldPlane.point.join(",");
    }
    const plane = slicePlaneRef.current;
    if (!plane) return;
    positionSlicePlane(plane, geometry, sliceIndex);
  }, [geometry, sliceIndex]);

  return (
    <section aria-labelledby="anatomy-3d-title" className="relative flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-xl border bg-[#101827] text-white" style={{ borderColor: "var(--border)" }}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <div><h2 id="anatomy-3d-title" className="text-sm font-semibold">3D anatomy</h2><p className="text-xs text-slate-300">{manifest.coordinateSystem} physical space · scroll plane linked to CT</p></div>
        <button type="button" className="rounded-md border border-white/20 px-2.5 py-1.5 text-xs hover:bg-white/10" onClick={() => resetCameraRef.current()}>Reset view</button>
      </header>
      <div ref={hostRef} className="relative min-h-[27rem] flex-1 touch-none" aria-label="Interactive 3D anatomy model. Drag to rotate; scroll to zoom; click a structure to select it." />
      {status.loading && <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">Loading atlas structures…</div>}
      {status.error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded-lg border border-red-400/40 bg-red-950/90 px-3 py-2 text-sm text-red-100">{status.error}</div>}
    </section>
  );
}
