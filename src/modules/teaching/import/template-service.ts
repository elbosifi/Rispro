import { getTeachingCatalog, listTeachingQuestionBanks } from "../repositories/teaching-catalog-repository.js";

const REFERENCE_TYPES = ["textbook", "journal_article", "guideline", "society_document", "website", "other", "unknown"] as const;

export async function createTeachingImportTemplate() {
  const [catalog, questionBanks] = await Promise.all([getTeachingCatalog(), listTeachingQuestionBanks()]);
  const specialty = catalog.specialties[0]?.code ?? "radiology";
  const domain = catalog.domains.find((item) => item.parentCode === specialty)?.code ?? "neuroradiology";
  const topic = catalog.topics.find((item) => item.parentCode === domain)?.code ?? null;
  const subtopic = topic === null ? null : catalog.subtopics.find((item) => item.parentCode === topic)?.code ?? null;
  const classification = {
    specialty,
    domain,
    topic,
    subtopics: subtopic === null ? [] : [subtopic],
    modalities: catalog.modalities.slice(0, 1).map((item) => item.code),
    competencies: catalog.competencies.slice(0, 2).map((item) => item.code),
    trainingLevel: catalog.trainingLevels[0]?.code ?? null,
    difficulty: catalog.difficulties.find((item) => item.value === 3)?.value ?? catalog.difficulties[0]?.value ?? 3,
    tags: catalog.tags.slice(0, 1).map((item) => item.code),
  };

  const source = {
    type: "textbook",
    title: "Synthetic example only — replace with a supplied source",
    organization: "Example Publisher",
    authors: ["Example Author"],
    edition: "7th",
    year: 2025,
    chapter: "Example Chapter",
    page: "412",
    questionNumber: null,
    url: null,
    doi: null,
  };
  const explanation = {
    summary: "Synthetic explanation used only to demonstrate the import shape.",
    teachingPoint: "Synthetic teaching point; replace it with evidence from the supplied material.",
    furtherDiscussion: null,
    optionExplanations: { A: "Synthetic distractor explanation.", B: "Synthetic correct-option explanation." },
  };
  const options = [{ id: "A", text: "Synthetic option A" }, { id: "B", text: "Synthetic option B" }];
  const base = {
    classification,
    stem: "Synthetic example question. Replace with content from the supplied educational source.",
    options,
    answerKey: ["B"],
    explanation,
    source,
    provenance: { relationshipToSource: "adapted" },
    references: [{
      type: "guideline",
      title: "Synthetic example guideline — do not cite as real",
      organization: "Example Society",
      year: 2025,
      url: null,
      doi: null,
    }],
    generation: { method: "ai_assisted", model: "Example model name" },
    status: "draft",
  };

  return {
    schemaVersion: "1.0",
    _instructions: {
      purpose: "This file describes the current RISpro Teaching Q-bank import format. The questions array is the only import payload.",
      catalog: "Use exact active codes from _catalog for specialties, domains, topics, subtopics, modalities, competencies, training levels, difficulties and tags.",
      draft: "Every imported question is created as Draft and must complete the normal faculty review before publication.",
      evidence: "Do not fabricate sources, provenance, references, URLs, DOI values, examination details, page numbers or question numbers. Use null when information is unknown.",
      images: "Supply image files separately in a ZIP archive under assets/ and refer to them by filename. Do not embed base64 image data.",
      audit: "Do not supply IDs, user identities, timestamps, review/publication audit fields or other server-owned metadata.",
      examples: "All values under _schemaExamples are synthetic illustrations and are never imported.",
    },
    _aiInstructions: [
      "You are converting supplied educational material into RISpro Teaching Q-bank JSON.",
      "Return valid JSON only, with schemaVersion and questions in this accepted format.",
      "Use only taxonomy values present in _catalog.",
      "Do not invent specialties, domains, topics, subtopics, modalities, competencies, tags or question banks.",
      "Do not invent source details, references, textbook page numbers, DOI values, examination years, sittings, papers or question numbers.",
      "If provenance information is unknown, use null rather than guessing.",
      "Every question must have a unique externalId.",
      "Every V1 question must have exactly one correct answer.",
      "Provide a meaningful explanation and option explanations whenever the supplied material supports them.",
      "Preserve the educational meaning of the supplied source.",
      "Set imported question status to draft.",
      "Do not create server-owned fields such as reviewedBy, publishedBy, IDs, timestamps or internal user IDs.",
      "For image questions, use media asset references and place matching files in assets/ inside a ZIP; never use base64.",
      "No AI service is connected to RISpro. The user transfers this template and source material to an AI model manually.",
    ],
    _catalog: {
      specialties: catalog.specialties,
      domains: catalog.domains,
      topics: catalog.topics,
      subtopics: catalog.subtopics,
      modalities: catalog.modalities,
      competencies: catalog.competencies,
      trainingLevels: catalog.trainingLevels,
      difficulties: catalog.difficulties,
      tags: catalog.tags,
      questionTypes: catalog.supportedQuestionTypes,
      sourceTypes: catalog.supportedSourceTypes,
      provenanceRelationships: catalog.supportedProvenanceRelationships,
      referenceTypes: REFERENCE_TYPES,
      questionBanks,
    },
    _schemaExamples: {
      single_best_answer: {
        ...base,
        externalId: "EXAMPLE-SBA-0001",
        type: "single_best_answer",
      },
      image_based_sba: {
        ...base,
        externalId: "EXAMPLE-IMAGE-0001",
        type: "image_based_sba",
        media: [{ assetKey: "EXAMPLE-IMAGE-0001-01", filename: "example_mri.png", type: "image", altText: "Synthetic axial MRI example image" }],
      },
      case_based_sba: {
        ...base,
        externalId: "EXAMPLE-CASE-QUESTION-0001",
        type: "case_based_sba",
        caseId: "EXAMPLE-CASE-0001",
        case: { title: "Synthetic case only", clinicalHistory: "Synthetic history; do not treat as patient data." },
      },
    },
    questions: [],
  };
}
