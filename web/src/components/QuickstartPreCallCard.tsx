"use client";

import { Loader2 } from "lucide-react";

import { HoverLetters } from "@/components/HoverLetters";
import { Button } from "@/components/ui/button";

type QuickstartPreCallCardProps = {
	isLoading: boolean;
	error: string | null;
	userKey: string;
	onUserKeyChange: (value: string) => void;
	onStartConversation: () => void;
};

export function QuickstartPreCallCard({
	isLoading,
	error,
	userKey,
	onUserKeyChange,
	onStartConversation,
}: QuickstartPreCallCardProps) {
	return (
		<div
			className="relative mx-auto flex w-[min(92vw,28rem)] animate-fade-up flex-col items-center rounded-[22px] border border-border bg-card px-10 py-10 text-center shadow-[0_24px_60px_rgba(20,22,31,0.10)]"
		>
			<h1 className="text-[44px] font-bold italic leading-[1.05] tracking-[-0.035em] text-foreground">
				<HoverLetters text="Meet" /> <span className="palette-gradient-text">Maya</span>
			</h1>
			<p className="mt-[14px] text-sm font-medium leading-6 text-muted-foreground">
				Maya remembers what you tell her. Share your name so your next call picks up
				where this one left off.
			</p>

			<div className="mt-8 w-full">
				<label
					htmlFor="user-key-input"
					className="mb-1.5 block text-left text-xs font-medium text-muted-foreground"
				>
					Your name <span className="text-muted-foreground/60">(optional — leave blank to stay anonymous)</span>
				</label>
				<input
					id="user-key-input"
					type="text"
					value={userKey}
					onChange={(e) => onUserKeyChange(e.target.value)}
					placeholder="e.g. Alex"
					disabled={isLoading}
					className="w-full rounded-lg border border-input bg-muted px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
				/>
			</div>

			<Button
				onClick={onStartConversation}
				disabled={isLoading}
				className="mt-6 h-11 w-full rounded-xl border border-primary bg-primary text-sm font-semibold text-white shadow-[0_10px_24px_rgba(25,130,196,0.28)] transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-white disabled:hover:translate-y-0 disabled:hover:border-primary disabled:hover:bg-primary"
				aria-label={
					isLoading
						? "Starting conversation with Maya"
						: "Start conversation with Maya"
				}
			>
				{isLoading ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" />
						Starting...
					</>
				) : (
					"Start Conversation"
				)}
			</Button>
			{error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
		</div>
	);
}
