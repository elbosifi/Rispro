local ROUTE_PREFIX = 'rispro_route_'
local RECONCILIATION_LABEL = 'rispro_patient_identity_reconciliation'
local RECONCILIATION_SOURCE_LABEL = 'rispro_patient_identity_reconciliation_source'

local function HasLabel(resourcePath, label)
  local ok, labels = pcall(function() return ParseJson(RestApiGet(resourcePath .. '/labels')) end)
  if not ok then return nil end
  for _, value in ipairs(labels) do if value == label then return true end end
  return false
end

local function MustSuppress(seriesId, metadata)
  local ok, study = pcall(function() return ParseJson(RestApiGet('/series/' .. seriesId .. '/study')) end)
  if not ok or study['ID'] == nil then return true end
  local direct = HasLabel('/studies/' .. study['ID'], RECONCILIATION_LABEL)
  if direct == nil then return true end
  if direct then return true end
  if metadata['ModifiedFrom'] ~= nil then
    local sourceOk, sourceStudy = pcall(function() return ParseJson(RestApiGet('/series/' .. metadata['ModifiedFrom'] .. '/study')) end)
    if not sourceOk or sourceStudy['ID'] == nil then return true end
    local source = HasLabel('/studies/' .. sourceStudy['ID'], RECONCILIATION_SOURCE_LABEL)
    if source == nil then return true end
    if source then return true end
  end
  return false
end

local function IsRisproRouteModality(modality)
  return string.sub(modality, 1, string.len(ROUTE_PREFIX)) == ROUTE_PREFIX
end

function OnStableSeries(seriesId, tags, metadata)
  if MustSuppress(seriesId, metadata) then return end
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
