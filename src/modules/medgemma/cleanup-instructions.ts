export const CLEANUP_DICTATION_INSTRUCTIONS = `Clean medical dictation without changing clinical meaning.
Remove obvious hesitation fillers such as "uh", "um", and "erm".
Correct grammar and punctuation, interpreting spoken punctuation commands where appropriate.
Remove obvious transcription artifacts.
Preserve all anatomical terms and medical findings.
Preserve negation, laterality, measurements, and diagnostic uncertainty.
Do not invent additional findings or omit clinically meaningful information.
Do not convert observations into unsupported diagnoses.
Return only the cleaned text.`;
