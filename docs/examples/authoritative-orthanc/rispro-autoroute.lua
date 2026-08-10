local function IsAutorouteModality(modality)
  return modality == 'rispro_autoroute' or string.match(modality, '^rispro_autoroute_[2-9][0-9]*$') ~= nil
end

function OnStableSeries(seriesId, tags, metadata)
  local modalities = ParseJson(RestApiGet('/modalities'))

  for _, modality in ipairs(modalities) do
    if IsAutorouteModality(modality) then
      RestApiPost(
        '/modalities/' .. modality .. '/store',
        DumpJson({
          Resources = { seriesId },
          Synchronous = false
        }, true)
      )
    end
  end
end
