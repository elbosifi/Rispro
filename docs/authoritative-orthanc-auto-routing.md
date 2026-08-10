# Authoritative Orthanc stable-series auto-routing

RISpro controls a managed remote-modality alias family on Authoritative Orthanc. The first selected existing PACS Connection is copied to `rispro_autoroute`; additional selections use `rispro_autoroute_2`, `rispro_autoroute_3`, and so on. Changing the selection updates those aliases and removes managed aliases that are no longer used. Turning auto-routing off removes all managed aliases; HTTP 404 means an alias is already disabled.

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

Restart or reload Authoritative Orthanc as required by that deployment. Do not add this script to RISpro's internal Orthanc configuration. The Lua callback uses Authoritative Orthanc's internal `RestApiGet` and `RestApiPost` functions. On each `OnStableSeries` event, it returns without routing when no managed aliases exist; otherwise it submits that series asynchronously to every managed `rispro_autoroute` alias.

## Manual validation

Use a non-production or otherwise approved deidentified destination and test data.

1. In RISpro Authoritative Orthanc settings, enable stable-series auto-routing and select two or more existing PACS destinations.
2. From Authoritative Orthanc, C-ECHO every managed alias (`rispro_autoroute`, `rispro_autoroute_2`, and so on), or otherwise confirm DICOM connectivity to every selected destination.
3. Send one test imaging series into Authoritative Orthanc.
4. Wait for the stable-series event and confirm the series arrives at every selected destination.
5. Turn stable-series auto-routing off in RISpro.
6. Send another test series and confirm it is not routed.
7. Turn stable-series auto-routing on again.
8. Add or send a RISpro-generated clinical-document/Secondary Capture series and confirm it is routed.
