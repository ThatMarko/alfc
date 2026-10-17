.pragma library

// Kirigami InlineMessage and PlaceholderMessage expose text but not the
// underlying label's textFormat. Wrap escaped literal text so their automatic
// rich-text detection cannot interpret diagnostics as tags or links.
function literalText(value) {
    return '<span style="white-space: pre-wrap;">'
        + String(value ?? "").replace(/&/g, "&amp;")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;")
        + '</span>'
}
