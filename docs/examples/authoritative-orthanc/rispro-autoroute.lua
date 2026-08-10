local AUTOROUTE_MODALITY = 'rispro_autoroute'

function OnStableSeries(seriesId, tags, metadata)
  local modalities = ParseJson(RestApiGet('/modalities'))

  for _, modality in ipairs(modalities) do
    if modality == AUTOROUTE_MODALITY then
      RestApiPost(
        '/modalities/' .. AUTOROUTE_MODALITY .. '/store',
        DumpJson({
          Resources = { seriesId },
          Synchronous = false
        }, true)
      )
      return
    end
  end
end
