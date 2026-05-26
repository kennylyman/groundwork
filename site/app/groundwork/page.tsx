"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Wordmark from "@/components/Wordmark";

type Role = "john" | "visitor";

type Message = {
  id: string;
  role: Role;
  content: string;
};

const JOHN_OPENER =
  "Home care agency? Tell me the one thing that's actually breaking down in your operation right now.";

export default function GroundworkPage() {
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: "opener", role: "john", content: JOHN_OPENER },
  ]);
  const [input, setInput] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [signupConfirmed, setSignupConfirmed] = useState(false);

  const sessionIdRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function getSessionId() {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return sessionIdRef.current;
  }

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isResponding]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isResponding) return;
      const sessionId = getSessionId();

      const visitorMsg: Message = {
        id: `v-${Date.now()}`,
        role: "visitor",
        content: trimmed,
      };
      const johnId = `j-${Date.now()}`;
      const johnMsg: Message = { id: johnId, role: "john", content: "" };

      const nextHistory = [...messages, visitorMsg];
      setMessages([...nextHistory, johnMsg]);
      setInput("");
      setIsResponding(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            messages: nextHistory.map((m) => ({
              role: m.role === "john" ? "assistant" : "user",
              content: m.content,
            })),
          }),
        });

        if (!res.body) {
          setIsResponding(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Split by SSE event delimiter (\n\n)
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            // Each event may contain multiple data: lines
            const dataLines = rawEvent
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart());

            for (const line of dataLines) {
              if (line === "[DONE]") {
                break outer;
              }
              try {
                const obj = JSON.parse(line);
                if (typeof obj.text === "string") {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === johnId
                        ? { ...m, content: m.content + obj.text }
                        : m,
                    ),
                  );
                }
                if (obj.signup === true) {
                  setSignupConfirmed(true);
                }
              } catch {
                // Ignore non-JSON data lines
              }
            }
          }
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === johnId && m.content === ""
              ? {
                  ...m,
                  content:
                    "Something cut the connection. Try again — or email hello@gwork.tech.",
                }
              : m,
          ),
        );
      } finally {
        setIsResponding(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [isResponding, messages],
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "var(--ground)", color: "var(--bone)" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-4 px-5 md:px-8 py-4 border-b border-white/5 shrink-0">
        <div className="text-white">
          <Wordmark size={22} />
        </div>
        <div className="hidden sm:block font-mono text-[10px] md:text-xs uppercase tracking-wider text-white/45 text-right">
          Home Care Setup Wizard
        </div>
      </header>

      {/* Conversation */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-8"
      >
        <div className="mx-auto max-w-3xl flex flex-col gap-6">
          {messages.map((m) =>
            m.role === "john" ? (
              <JohnBubble key={m.id} content={m.content} />
            ) : (
              <VisitorBubble key={m.id} content={m.content} />
            ),
          )}
          {isResponding &&
            messages[messages.length - 1]?.role === "john" &&
            messages[messages.length - 1]?.content === "" && <TypingIndicator />}
          {signupConfirmed && (
            <div className="self-start text-sm font-mono text-bolt/90">
              ✓ Check your email
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-white/10 bg-ground">
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl px-4 md:px-8 py-4 flex items-center gap-3"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isResponding}
            placeholder="Type your message..."
            autoComplete="off"
            className="flex-1 bg-bone text-ground placeholder-ground/40 px-4 py-3 md:py-3.5 outline-none focus:ring-2 focus:ring-bolt/60 disabled:opacity-60"
            style={{ fontFamily: "var(--font-sans)" }}
          />
          <button
            type="submit"
            disabled={isResponding || !input.trim()}
            aria-label="Send message"
            className="bg-bolt text-ground px-4 py-3 md:py-3.5 font-bold hover:brightness-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="block text-lg leading-none">→</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function JohnBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-3 self-start max-w-[88%] md:max-w-[75%]">
      <div
        aria-hidden="true"
        className="shrink-0 w-8 h-8 flex items-center justify-center font-mono text-[10px] font-bold text-ground bg-bolt mt-0.5"
      >
        GW
      </div>
      <div className="text-bone text-base md:text-lg leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

function VisitorBubble({ content }: { content: string }) {
  return (
    <div
      className="self-end max-w-[88%] md:max-w-[75%] px-4 py-3 text-bone text-base md:text-[17px] leading-relaxed whitespace-pre-wrap"
      style={{ background: "#1a1a1a" }}
    >
      {content}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 self-start">
      <div
        aria-hidden="true"
        className="shrink-0 w-8 h-8 flex items-center justify-center font-mono text-[10px] font-bold text-ground bg-bolt mt-0.5"
      >
        GW
      </div>
      <div
        className="flex items-center gap-1.5 px-1 py-2"
        aria-label="John is typing"
      >
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-bone/60"
      style={{
        animation: "gw-pulse 1.2s ease-in-out infinite",
        animationDelay: `${delay}ms`,
      }}
    />
  );
}
