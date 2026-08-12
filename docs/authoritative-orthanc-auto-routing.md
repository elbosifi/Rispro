# Authoritative Orthanc stable-series auto-routing

Operational monitoring and bounded recovery controls are documented in [Authoritative Orthanc Operations](authoritative-orthanc-operations.md). Configuration remains in Settings; live monitoring and explicit tests/retries live under Systems.

RISpro controls a managed remote-modality alias family with the exact prefix `rispro_route_` on Authoritative Orthanc. Each selected existing PACS Connection is copied to a descriptive alias derived from its stable connection key, such as `iMac` to `rispro_route_imac`, `SonicDICOM` to `rispro_route_sonicdicom`, or `Backup PACS` to `rispro_route_backup_pacs`. The user-facing PACS Connection name is unchanged. If selected keys collide after safe slugging, RISpro appends a deterministic suffix derived from the original stable key instead of using route-order numbers.

Changing a PACS connection's AET, host, or port updates the same descriptive alias. Removing a selection or turning auto-routing off removes only RISpro-managed `rispro_route_` aliases. Each reconciliation also removes obsolete aliases from the previous `rispro_autoroute`, `rispro_autoroute_2`, and numbered scheme. Unrelated Authoritative Orthanc modalities are never removed; HTTP 404 means an obsolete alias is already absent.

The actual routing stays inside Authoritative Orthanc. RISpro does not run a routing worker, store routing jobs or history, retry transfers, or alter study completeness, PACS auto-completion, or DICOM remap behavior.

## One-time Authoritative Orthanc prerequisite

Copy [rispro-autoroute.lua](examples/authoritative-orthanc/rispro-autoroute.lua) to a permanent path on the Authoritative Orthanc host, then configure that Authoritative Orthanc installation with both settings below:

```json
{
  "DicomModalitiesInDatabase": true,
  "LuaScripts": [
    "/permanent/path/rispro-autoroute.lua"
  ]
}
```

Restart or reload Authoritative Orthanc as required by that deployment. Do not add this script to RISpro's internal Orthanc configuration. The Lua callback uses Authoritative Orthanc's internal `RestApiGet` and `RestApiPost` functions. On each `OnStableSeries` event, it discovers every modality whose key begins with `rispro_route_`; it returns without routing when none exist and otherwise submits the series asynchronously to every discovered route.

## Manual validation

Use a non-production or otherwise approved deidentified destination and test data.

1. In RISpro Authoritative Orthanc settings, enable stable-series auto-routing and select two or more existing PACS destinations.
2. From Authoritative Orthanc, C-ECHO every managed descriptive alias (`rispro_route_<destination>`), or otherwise confirm DICOM connectivity to every selected destination.
3. Send one test imaging series into Authoritative Orthanc.
4. Wait for the stable-series event and confirm the series arrives at every selected destination.
5. Turn stable-series auto-routing off in RISpro.
6. Send another test series and confirm it is not routed.
7. Turn stable-series auto-routing on again.
8. Add or send a RISpro-generated clinical-document/Secondary Capture series and confirm it is routed.
