# Teaching Anatomy atlases

Teaching Anatomy is an education-only application area. Its anatomy data and viewers do not use clinical patients, PACS, OHIF, appointments, reporting, or clinical DICOM services. No database migration is required.

## Catalog and viewer

`/teaching/anatomy` provides region, organ, system, and source search. `/teaching/anatomy/sources` lists upstream attribution and license links. Each installed dataset opens at `/teaching/anatomy/atlas/:atlasId`; `/teaching/anatomy/liver` remains as a compatibility route.

The authenticated Teaching API reads its catalog and V1/V2 manifests from the configured anatomy asset root. V1 is retained for the liver manifest. V2 declares modality, physical coordinate systems, optional image and segmentation volumes, supported planes, structures, assets, integrity digests, provenance, and spatial validation. Asset requests identify an atlas and a manifest-declared asset key; arbitrary file paths are not accepted. Every request uses the normal Teaching session boundary.

CT and MRI volumes use the same geometry-based reslicer for axial, coronal, and sagittal views. The selected structure can be overlaid from its label value, and the Three.js view receives the same physical plane and slice position. Every installed regional mesh must pass the source installer’s physical-bound and mesh-to-label checks; meshes without sufficient label agreement are omitted. The viewer keeps the working RISpro Three.js engine. It does not import Mulrecon Color code.

For atlases with more than 40 mesh surfaces, the 3D viewer fetches the selected surface on demand and disposes it when another surface is selected. This keeps BodyParts3D’s 1,258 OBJ surfaces out of the initial browser request. The BodyParts3D surfaces remain at their published whole-body coordinates and are not registered to the regional image atlases.

## Validated source packages

The source lock is [open-atlas-sources.lock.json](../scripts/teaching-anatomy/open-atlas-sources.lock.json). It pins HTTPS URLs, compressed byte counts, and SHA-256 digests. Setup and update run [provision-teaching-anatomy.mjs](../scripts/teaching-anatomy/provision-teaching-anatomy.mjs) inside the app container. Downloads are host-allow-listed, size/hash checked, safely extracted, validated, and staged under the existing `/app/storage` volume. Each atlas activates independently; one optional failure does not stop RISpro. The deploy log reports a per-atlas status and an overall ready/partial/unavailable result.

| Dataset | Upstream package | Installed source | Validation and use |
| --- | --- | --- | --- |
| SPL Liver Atlas | [SPL Liver Atlas](https://github.com/lorensen/SPLLiverAtlas), pinned Git commit in the liver lock | CT, segmentation, color table, and 17 STL surfaces | Existing V1 manifest is accepted and adapted to the shared engine. |
| SPL Abdominal Atlas | [Open Anatomy abdomen archive](https://www.openanatomy.org/atlases/nac/abdomen-2016-09.zip), 34,861,066 bytes | CT, segmentation, hierarchy, and 94 mapped VTK surfaces | Image and labels match; 94 surfaces passed physical and label validation; 105 hierarchy entries. |
| SPL Head and Neck Atlas | [Open Anatomy head/neck archive](https://www.openanatomy.org/atlases/nac/head-neck-2016-09.zip), 31,612,667 bytes | CT, segmentation, hierarchy, and 59 mapped VTK surfaces | Image and labels match; 59 surfaces passed physical and label validation; 67 hierarchy entries. |
| SPL Knee Atlas | [Open Anatomy knee archive](https://www.openanatomy.org/atlases/nac/knee-2016-09.zip), 80,934,412 bytes | MRI, segmentation, hierarchy, and 48 mapped VTK surfaces | The source label map uses a different declared LPS affine and slice count. The installer preserves the original segmentation, derives a nearest-neighbor resampling from the two source affines, preserves every declared label, checks coverage, and validates all 48 surfaces against the normalized image grid; 59 hierarchy entries. |
| BodyParts3D whole-body navigator | [BodyParts3D 4.0 PART-OF 99% OBJ archive](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html), 64,888,505 bytes, plus three pinned official metadata tables | 1,258 OBJ surfaces, official anatomical names/relationships, and 2,072 searchable hierarchy entries | All OBJ IDs match the source element table; vertex and polygon data are validated. Coordinates are preserved as LPS millimeters. It is a separate adult-male reference model without cross-registration to CT/MRI. |

Brain, inner-ear, thorax, and PROSTATEx remain marked pending source validation. They are not served as available atlases until their exact source packages, licenses, asset mappings, and spatial checks pass. A not-installed status for a validated source means the data have not yet been provisioned into the current storage volume.

## License and attribution requirements

The Open Anatomy SPL packages and the existing SPL Liver Atlas are described under the [3D Slicer Contribution and Software License Agreement, Part B](https://www.openanatomy.org/atlas-pages/slicer-license.html). Part B grants a royalty-free, non-exclusive license to use, reproduce, modify, display, and distribute the licensed data, including incorporation into proprietary programs, subject to its terms. It requires the complete Part B terms and applicable attribution/copyright/license notices to accompany copies, requires modified versions to be identified, and says the source data are for research purposes; clinical applications are neither recommended nor advised. RISpro uses these data only as non-clinical Teaching references. The installer preserves each source package’s license/readme, includes the full Part B text in `UPSTREAM-LICENSE`, and writes a dataset-specific `NOTICE.txt`. Preserve these files with every installed or copied atlas.

BodyParts3D is licensed under [CC BY 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Its required attribution is: **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International**. The installed `NOTICE.txt`, manifest, library source record, and this documentation retain that attribution. The official source permits data acquisition, redistribution, and derivative works under its stated terms; attribution is required when distributing the data or adapted material.

The [Mulrecon Color source package](https://www.castlemountain.dk/atlas/index.php?mulreconPage=color&page=mulrecon) was inspected separately. The downloaded source archive contains a monolithic viewer and bundled dependencies but no license or redistribution notice. RISpro therefore does not copy its implementation or data-loading code. The current RISpro viewer remains in place.

## Provisioning and local validation

Docker setup and update invoke the shared noninteractive anatomy provisioner after the app is healthy. All atlas files live under `TEACHING_ANATOMY_ASSET_ROOT` (default `/app/storage/uploads/teaching/anatomy`). Downloads and unpacked staging directories are temporary; activation swaps only a fully validated atlas directory into place and retains an earlier installation if a replacement fails. No anatomy binaries are checked into the repository and no browser-time source downloads are used.

For offline installer work, use the dedicated installer with an already acquired, license-complete source directory. For example:

```powershell
node scripts/teaching-anatomy/install-open-anatomy-atlas.mjs spl-abdomen C:\data\abdomen-2016-09 storage\uploads\teaching\anatomy
node scripts/teaching-anatomy/install-bodyparts3d.mjs C:\data\bodyparts3d storage\uploads\teaching\anatomy
```

Production setup/update uses the pinned provisioner instead of these local commands. Do not manually label a source as ready or bypass the source validation checks.

## Validation and limits

Focused tests cover V1/V2 manifest parsing, safe asset paths, authentication, volume geometry/reslicing, VTK conversion, source pinning/redirect handling, optional-failure isolation, and atlas/source pages. The supported browser journey checks the liver overlay and synchronized axial/coronal/sagittal planes, then checks that a large 3D-only atlas fetches only its selected mesh and shows its attribution.

Spatial checks establish source grid geometry and deterministic mesh/label agreement, not medical suitability or clinical accuracy. The source agreement itself states that these datasets are research-purpose material and does not recommend or advise clinical applications. The BodyParts3D model is an adult male reference and should be presented with that source limitation; its surfaces are not a patient model or a substitute for a correlated regional atlas.
