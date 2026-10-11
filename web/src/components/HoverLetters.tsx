// Splits text into letters that each take a palette colour on hover.
// Screen readers get the plain text via aria-label.
export function HoverLetters({ text, offset = 0 }: { text: string; offset?: number }) {
	let index = offset;
	return (
		<span className="hover-letters" aria-label={text}>
			{text.split(/(\s+)/).map((part, wordIndex) => {
				if (/^\s+$/.test(part)) return part;
				return (
					<span key={`${wordIndex}-${part}`} className="hl-word" aria-hidden="true">
						{Array.from(part).map((char, charIndex) => (
							<span key={charIndex} className={`hl hl-${index++ % 5}`}>
								{char}
							</span>
						))}
					</span>
				);
			})}
		</span>
	);
}
