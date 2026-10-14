"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TimeAgo } from "@/components/time-ago";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { MemberRole } from "@/lib/auth/roles";
import { firstName } from "@/lib/names";
import { assignConversation } from "./actions";

export type Person = { id: string; name: string; role: MemberRole };

export type AttentionItem = {
  id: string;
  contactName: string;
  reason: string | null;
  summary: string | null;
  preview: string | null;
  score: number | null;
  waitingSince: string | null;
  assignedTo: string | null;
  assignedName: string | null;
};

/** Lista de conversas que precisam da equipe, com "Assumir" (escolhendo o vendedor) e "Abrir conversa". */
export function AttentionList({
  slug,
  items,
  people,
  viewerId,
  emptyText,
}: {
  slug: string;
  items: AttentionItem[];
  people: Person[];
  viewerId: string;
  emptyText: string;
}) {
  if (!items.length) return <div className="empty">{emptyText}</div>;
  return (
    <div className="row-list">
      {items.map((it) => (
        <Row key={it.id} slug={slug} item={it} people={people} viewerId={viewerId} />
      ))}
    </div>
  );
}

function Row({ slug, item, people, viewerId }: { slug: string; item: AttentionItem; people: Person[]; viewerId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState(item.assignedTo && people.some((p) => p.id === item.assignedTo) ? item.assignedTo : viewerId);
  const [pending, start] = useTransition();

  function assume() {
    start(async () => {
      const r = await assignConversation(slug, { conversationId: item.id, userId });
      if (r.ok) {
        toast(r.message ?? "Conversa assumida.", "ok");
        router.refresh();
      } else toast(r.error, "bad");
    });
  }

  return (
    <div className="q-item">
      {item.score !== null && (
        <div className="score">
          {item.score}
          <small>score</small>
        </div>
      )}
      <div className="grow">
        <b>{item.contactName}</b>
        <p>
          {item.reason ? <strong className="font-semibold text-[var(--bad-fg)]">{item.reason}</strong> : "Mensagem do cliente sem resposta"}
          {item.waitingSince && (
            <>
              , esperando <TimeAgo date={item.waitingSince} />
            </>
          )}
        </p>
        {item.summary ? (
          <div className="summary mt-1.5">
            <b>Resumo da IA para a equipe</b>
            {item.summary}
          </div>
        ) : (
          item.preview && <p className="line-clamp-2">“{item.preview}”</p>
        )}
        <p>{item.assignedName ? <Pill>{firstName(item.assignedName)}</Pill> : <Pill tone="warn">Sem responsável</Pill>}</p>
      </div>
      <div className="q-acts">
        <select className="inp" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={`Quem vai atender ${item.contactName}`} disabled={pending}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === viewerId ? `${p.name} (eu)` : p.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="primary" loading={pending} onClick={assume}>
          Assumir
        </Button>
        <Link className="btn sm" href={`/${slug}/conversas?c=${item.id}`}>
          Abrir conversa
        </Link>
      </div>
    </div>
  );
}
