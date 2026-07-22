from __future__ import annotations

import unicodedata


def normalize_text(value: str) -> str:
    return "".join(
        character.casefold()
        for character in unicodedata.normalize("NFKC", value)
        if not unicodedata.category(character).startswith(("P", "Z"))
    )


def edit_distance(reference: str, candidate: str) -> int:
    if len(reference) < len(candidate):
        reference, candidate = candidate, reference
    previous = list(range(len(candidate) + 1))
    for row_index, reference_character in enumerate(reference, start=1):
        current = [row_index]
        for column_index, candidate_character in enumerate(candidate, start=1):
            current.append(
                min(
                    current[column_index - 1] + 1,
                    previous[column_index] + 1,
                    previous[column_index - 1] + int(reference_character != candidate_character),
                )
            )
        previous = current
    return previous[-1]


def character_error_rate(reference: str, candidate: str) -> float:
    normalized_reference = normalize_text(reference)
    normalized_candidate = normalize_text(candidate)
    if len(normalized_reference) == 0:
        return 0.0 if len(normalized_candidate) == 0 else 1.0
    return edit_distance(normalized_reference, normalized_candidate) / len(normalized_reference)


def keyword_recall(expected: list[str], candidate: str) -> float:
    if len(expected) == 0:
        return 1.0
    normalized_candidate = normalize_text(candidate)
    matched = sum(normalize_text(keyword) in normalized_candidate for keyword in expected)
    return matched / len(expected)
