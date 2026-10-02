# Teaching Anatomy proof of concept

The initial reference workspace is the SPL Liver Atlas. It is an educational feature inside the independent Teaching application. It has no connection to clinical OHIF, PACS, appointments, patients, reporting, or clinical DICOM workflows. No database migration is required.

## Production deployment

For a Docker deployment, the administrator runs only:

```sh
./scripts/setup-docker.sh
```

or:

```sh
./scripts/update-docker.sh
```

After the app is healthy, both commands run a noninteractive provisioner inside `rispro-app`. It stores the atlas at `/app/storage/uploads/teaching/anatomy/spl-liver`, within the existing `rispro-storage:/app/storage` Docker volume. No additional volume, Git checkout, Git LFS installation, or browser-time download is used.

The checked-in [asset lock](../scripts/teaching-anatomy/spl-liver-atlas.lock.json) pins upstream commit `6630f4d4ff047937545287de92ccbb5590273ca5` and package version `spl-liver-2019-06-24.1`. It declares the direct HTTPS media URL, exact byte size, and SHA-256 for the CT NRRD, label-map NRRD, color table, and 17 required STL meshes. The provisioner accepts only those fixed HTTPS URLs, bounds redirects and download sizes, rejects Git LFS pointer text, streams hashes, stages all files inside persistent Teaching storage, validates the atlas geometry and mesh/label relationship, and atomically activates only a complete atlas.

On later setup or update runs it hashes the installed managed assets and reports `Teaching Anatomy: already current` without downloading when the lock version and integrity are unchanged. A future lock-version change stages and validates the replacement before activation. A network or validation failure preserves an earlier valid atlas and leaves RISpro running; the summary reports `Teaching Anatomy: unavailable - provisioning failed` when no valid managed atlas can be made available.

Runtime RISpro serves the CT, labels, and STL files only through authenticated `/api/teaching/anatomy/liver/*` endpoints. File requests use manifest asset IDs and never accept filesystem paths.

## Developer or offline installation

The local importer remains available for developer and offline troubleshooting. Clone or use an existing local [SPLLiverAtlas checkout](https://github.com/lorensen/SPLLiverAtlas), fetch its Git LFS objects, then run:

```powershell
node scripts/teaching-anatomy/install-spl-liver-atlas.mjs --source C:\data\SPLLiverAtlas
```

By default it installs under `storage/uploads/teaching/anatomy/spl-liver`. `TEACHING_ANATOMY_ASSET_ROOT` remains supported to override the root. The local importer uses the same staged activation and geometry checks, but is not the supported production workflow.

## Spatial coordinate contract

The browser reads the NRRD header and retains the full CT and segmentation arrays. It requires three dimensions, an LPS or RAS coordinate system, origin, and three non-zero spatial direction vectors. CT and label-map dimensions and affine geometry must match. Each displayed slice plane is calculated as `space origin + slice index * third space direction`; the model camera and slice plane use the coordinates declared by the manifest. The viewer does not derive position from a percentage or from an STL Z coordinate.

The installer records deterministic per-mesh checks in the manifest: CT and label-map geometry match; each STL bounds fit in the CT physical bounds; and sampled STL vertices overlap the assigned label within one voxel. Because STL files do not encode a coordinate system, the manifest declares the upstream SPL mesh coordinates as RAS; the installer uses only the standard RAS/LPS X/Y inversion when comparing them with the NRRD coordinate system and rejects poor label overlap. The browser independently checks that loaded model bounds fit the NRRD volume. These checks do not replace visual review in 3D Slicer or the RISpro viewer when installing new source files.

## Source and attribution

Source dataset: [SPL Liver Atlas](https://github.com/lorensen/SPLLiverAtlas), a joint project of Boston Medical Center and the Surgical Planning Laboratory, Brigham and Women's Hospital, Harvard Medical School. Attribution in the installed notice credits M. Jakab, S. Pujol, K. Shaffer, R. Kikinis, and other upstream contributors. RISpro adapts the atlas as educational material; it is not RISpro patient data.

The Open Anatomy Project describes SPL atlases as available under the [3D Slicer Contribution and Software License Agreement](https://www.openanatomy.org/atlas-pages/slicer-license.html). The source checkout's README and any license file are copied into the installed asset directory. Preserve the upstream attribution and license notices when handling or redistributing atlas material.

## Tests and limitations

Focused automated tests use small synthetic NRRD buffers and a manifest fixture; normal CI does not need the atlas binaries. Real spatial review requires the locally installed Git LFS assets. Confirm the CT/label overlay and the moving plane in 3D for several axial levels, then select Segment VIII and verify manifest label 33 on its occupied slices before extending this work to another atlas.
