# Authoritative Orthanc stable-series auto-routing

RISpro controls one fixed remote-modality alias, `rispro_autoroute`, on Authoritative Orthanc. When auto-routing is enabled, RISpro copies the selected existing PACS Connection's AET, host, and port to that alias. Changing the destination updates the same alias. Turning auto-routing off removes the alias; HTTP 404 means it is already disabled.

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

Restart or reload Authoritative Orthanc as required by that deployment. Do not add this script to RISpro's internal Orthanc configuration. The Lua callback uses Authoritative Orthanc's internal `RestApiGet` and `RestApiPost` functions. On each `OnStableSeries` event, it returns immediately when `rispro_autoroute` is absent; otherwise it submits that series to `/modalities/rispro_autoroute/store` asynchronously.

## Manual validation

Use a non-production or otherwise approved deidentified destination and test data.

1. In RISpro Authoritative Orthanc settings, enable stable-series auto-routing and select one existing PACS destination.
2. From Authoritative Orthanc, C-ECHO `rispro_autoroute` (or otherwise confirm DICOM connectivity to the selected destination).
3. Send one test imaging series into Authoritative Orthanc.
4. Wait for the stable-series event and confirm the series arrives at the selected destination.
5. Turn stable-series auto-routing off in RISpro.
6. Send another test series and confirm it is not routed.
7. Turn stable-series auto-routing on again.
8. Add or send a RISpro-generated clinical-document/Secondary Capture series and confirm it is routed.
