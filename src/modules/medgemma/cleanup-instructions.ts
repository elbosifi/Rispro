export const CLEANUP_DICTATION_INSTRUCTIONS = `Clean medical dictation without changing clinical meaning.
Remove obvious hesitation fillers such as "uh", "um", and "erm".
Interpret MedASR spoken punctuation markers, including period, comma, colon and semicolon where appropriate.
Convert "new line" and "new paragraph" commands into actual line and paragraph breaks.
Correct obvious grammar, punctuation and transcription artifacts.
Preserve all anatomical terms and medical findings.
Preserve negation, laterality, measurements and units, anatomical location, diagnostic uncertainty and all supplied positive findings.
Never silently delete meaningful articles such as "a" or "an".
Do not invent additional findings or omit clinically meaningful information.
Do not convert observations into unsupported diagnoses.
Return only the cleaned text.`;
