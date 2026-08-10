local ROUTE_PREFIX = 'rispro_route_'

local function IsRisproRouteModality(modality)
  return string.sub(modality, 1, string.len(ROUTE_PREFIX)) == ROUTE_PREFIX
end

function OnStableSeries(seriesId, tags, metadata)
  local modalities = ParseJson(RestApiGet('/modalities'))

  for _, modality in ipairs(modalities) do
    if IsRisproRouteModality(modality) then
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
