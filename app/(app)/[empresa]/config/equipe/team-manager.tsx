"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABEL, type MemberRole } from "@/lib/auth/roles";
import { initials } from "@/lib/names";
import { changeRole, inviteMember, setMemberActive, type ActionResult } from "./actions";

export type TeamMember = { id: string; name: string; email: string; role: MemberRole; active: boolean };

type TeamManagerProps = {
  members: TeamMember[];
  admins: { id: string; name: string; email: string }[];
  companyId: string;
  companyName: string;
  companies: { id: string; name: string }[];
  canEdit: boolean;
  viewerId: string;
};

export function TeamManager({ members, admins, companyId, companyName, companies, canEdit, viewerId }: TeamManagerProps) {
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toToggle, setToToggle] = useState<TeamMember | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast(result.message, "ok");
        after?.();
      } else {
        toast(result.error, "bad");
      }
    });
  }

  return (
    <>
      <Panel
        title={`Equipe da ${companyName}`}
        subtitle={`${members.filter((m) => m.active).length} pessoa(s) com acesso`}
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              Convidar pessoa
            </Button>
          )
        }
      >
        {members.length === 0 ? (
          <div className="empty">Ninguém da equipe foi incluído ainda.</div>
        ) : (
          <div className="scroll-x -mx-1">
            <table className="min-w-[620px]">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  {canEdit && <th className="text-right">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className={m.active ? undefined : "opacity-60"}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="av" aria-hidden>
                          {initials(m.name)}
                        </span>
                        <div className="min-w-0">
                          <b className="block font-semibold text-title">{m.name}</b>
                          <small className="text-xs text-muted">{m.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {canEdit ? (
                        <select
                          className="inp !min-h-[34px] !w-auto !py-1"
                          value={m.role}
                          disabled={pending}
                          aria-label={`Perfil de ${m.name}`}
                          onChange={(e) =>
                            run(() => changeRole({ userId: m.id, companyId, role: e.target.value as MemberRole }))
                          }
                        >
                          <option value="gestor">Gestor</option>
                          <option value="vendedor">Vendedor</option>
                        </select>
                      ) : (
                        ROLE_LABEL[m.role]
                      )}
                    </td>
                    <td>{m.active ? <Pill tone="ok">Ativo</Pill> : <Pill tone="bad">Desativado</Pill>}</td>
                    {canEdit && (
                      <td className="text-right">
                        {m.id !== viewerId && (
                          <Button
                            size="sm"
                            variant={m.active ? "danger" : "soft"}
                            disabled={pending}
                            onClick={() => (m.active ? setToToggle(m) : run(() => setMemberActive({ userId: m.id, active: true })))}
                          >
                            {m.active ? "Desativar" : "Reativar"}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canEdit && admins.length > 0 && (
        <Panel title="Administradores da plataforma" subtitle="Veem e configuram as duas empresas.">
          <div className="row-list">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 py-2.5">
                <span className="av" aria-hidden>
                  {initials(a.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block font-semibold text-title">
                    {a.name}
                    {a.id === viewerId && <span className="font-normal text-muted"> (você)</span>}
                  </b>
                  <small className="text-xs text-muted">{a.email}</small>
                </div>
                <Pill tone="ind">Administrador</Pill>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {canEdit && (
        <InviteModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          companies={companies}
          defaultCompanyId={companyId}
          onDone={(message) => {
            toast(message, "ok");
            setInviteOpen(false);
          }}
        />
      )}

      <Modal
        open={toToggle !== null}
        onClose={() => setToToggle(null)}
        title={`Desativar ${toToggle?.name ?? ""}?`}
        actions={
          <>
            <Button onClick={() => setToToggle(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => toToggle && run(() => setMemberActive({ userId: toToggle.id, active: false }), () => setToToggle(null))}
            >
              Desativar acesso
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13.5px]">
          A pessoa perde o acesso na hora, em todas as empresas. Leads, conversas e histórico dela continuam no sistema.
          Você pode reativar depois.
        </p>
      </Modal>
    </>
  );
}

type InviteModalProps = {
  open: boolean;
  onClose: () => void;
  companies: { id: string; name: string }[];
  defaultCompanyId: string;
  onDone: (message: string) => void;
};

function InviteModal({ open, onClose, companies, defaultCompanyId, onDone }: InviteModalProps) {
  const [method, setMethod] = useState<"convite" | "senha">("convite");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    setError(undefined);
    startTransition(async () => {
      const result = await inviteMember({
        fullName: String(data.get("fullName") ?? ""),
        email: String(data.get("email") ?? ""),
        companyId: String(data.get("companyId") ?? ""),
        role: String(data.get("role")) as MemberRole,
        method,
        password: method === "senha" ? String(data.get("password") ?? "") : undefined,
      });
      if (result.ok) {
        form.reset();
        setMethod("convite");
        onDone(result.message);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Convidar pessoa">
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome" name="fullName" required autoComplete="off" className="sm:col-span-2" />
          <TextField label="E-mail" name="email" type="email" required autoComplete="off" className="sm:col-span-2" />
          <SelectField label="Empresa" name="companyId" defaultValue={defaultCompanyId}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Perfil" name="role" defaultValue="vendedor">
            <option value="vendedor">Vendedor</option>
            <option value="gestor">Gestor</option>
          </SelectField>
        </div>

        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-muted">Como a pessoa vai entrar</legend>
          <label className="flex items-start gap-2.5 text-[13.5px]">
            <input type="radio" name="method" checked={method === "convite"} onChange={() => setMethod("convite")} className="mt-1 accent-accent" />
            <span>
              <b className="font-semibold">Convite por e-mail</b>
              <small className="block text-xs text-muted">A pessoa recebe um link e cria a própria senha.</small>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13.5px]">
            <input type="radio" name="method" checked={method === "senha"} onChange={() => setMethod("senha")} className="mt-1 accent-accent" />
            <span>
              <b className="font-semibold">Senha provisória</b>
              <small className="block text-xs text-muted">Você define a senha agora e passa para a pessoa. Não depende de e-mail.</small>
            </span>
          </label>
        </fieldset>

        {method === "senha" && (
          <TextField label="Senha provisória" name="password" type="text" minLength={8} required autoComplete="off" hint="Pelo menos 8 caracteres." />
        )}

        {error && <Notice tone="bad">{error}</Notice>}

        <div className="acts flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {method === "convite" ? "Enviar convite" : "Criar acesso"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
