"use client";

import { Loader2 } from "lucide-react";

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
			className="mx-auto flex w-[min(92vw,26.25rem)] animate-fade-up flex-col items-center rounded-[20px] border border-[#2b2b2b] px-10 py-10 text-center shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
			style={{
				backgroundImage:
					"linear-gradient(164.988deg, rgba(54,54,54,0.2) 1.0596%, rgba(0,0,0,0) 96.089%), linear-gradient(90deg, rgb(16,16,16) 0%, rgb(16,16,16) 100%)",
			}}
		>
			<h1 className="text-[28px] font-medium leading-[1.2] text-white">
				Meet Maya
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
					className="w-full rounded-lg border border-[#2b2b2b] bg-[#111] px-3 py-2 text-sm text-white placeholder-muted-foreground/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
				/>
			</div>

			<Button
				onClick={onStartConversation}
				disabled={isLoading}
				className="mt-6 h-10 w-full rounded-lg border border-primary bg-primary text-sm font-medium text-black hover:border-white hover:bg-white hover:text-black disabled:hover:border-primary disabled:hover:bg-primary disabled:hover:text-black"
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
