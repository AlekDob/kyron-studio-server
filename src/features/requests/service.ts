// Lettura e scrittura dei ticket del progetto Kyron su Linear (feature 022).
// Unico punto che tocca la rete: i tool e la route passano di qui.
import { LINEAR, linearQuery, type LinearLabel, type LinearState } from "@/core/linear/client.js";

/** Riga della lista: e' quello che vede il pannello a sinistra. */
export interface RequestRow {
  id: string;
  /** Codice leggibile, es. FUT-83. */
  identifier: string;
  title: string;
  description: string;
  url: string;
  /** Nome dello stato su Linear ("Todo", "In Progress", ...). */
  state: string;
  stateColor: string;
  /** Gruppo per i chip del pannello. */
  group: RequestGroup;
  labels: string[];
  /** Email di chi ha chiesto, dalla riga "Richiesto da:" in fondo. */
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type RequestGroup = "todo" | "doing" | "done";

const MARKER = "Richiesto da:";

const LIST_QUERY = `
  query Requests($projectId: ID!) {
    issues(
      filter: { project: { id: { eq: $projectId } } }
      first: 100
      orderBy: updatedAt
    ) {
      nodes {
        id identifier title description url createdAt updatedAt
        state { name type color }
        labels { nodes { name } }
      }
    }
  }
`;

const CREATE_MUTATION = `
  mutation CreateRequest($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier title url }
    }
  }
`;

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: { name: string; type: string; color: string } | null;
  labels: { nodes: Array<{ name: string }> } | null;
}

/** Il tipo di stato Linear diventa uno dei tre chip del pannello. */
function groupOf(type: string | undefined): RequestGroup {
  if (type === "started") return "doing";
  if (type === "completed" || type === "canceled") return "done";
  return "todo";
}

/**
 * L'email di chi ha chiesto sta in fondo alla descrizione: la key e' di Alek,
 * quindi i ticket risultano tutti suoi.
 *
 * Si estrae l'email nuda con la regex e non si prende la riga cosi' com'e':
 * Linear trasforma da sola gli indirizzi in link markdown
 * (`[tizio@x.it](<mailto:tizio@x.it>)`), e quel testo non combacerebbe mai con
 * l'email dell'utente nel filtro "solo le mie".
 */
function requesterOf(description: string): string {
  const line = description.split("\n").find((l) => l.includes(MARKER));
  const email = line?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  return email ?? "";
}

const toRow = (i: RawIssue): RequestRow => {
  const description = i.description ?? "";
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    description,
    url: i.url,
    state: i.state?.name ?? "",
    stateColor: i.state?.color ?? "#8a8f98",
    group: groupOf(i.state?.type),
    labels: (i.labels?.nodes ?? []).map((l) => l.name),
    requestedBy: requesterOf(description),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
};

export async function listRequests(): Promise<RequestRow[]> {
  const data = await linearQuery<{ issues: { nodes: RawIssue[] } }>(LIST_QUERY, {
    projectId: LINEAR.projectId,
  });
  return data.issues.nodes.map(toRow);
}

export interface CreateRequestInput {
  title: string;
  description: string;
  label: LinearLabel;
  state: LinearState;
  requestedBy: string;
}

export async function createRequest(input: CreateRequestInput): Promise<{
  identifier: string;
  title: string;
  url: string;
}> {
  const description = `${input.description.trim()}\n\n---\n${MARKER} ${input.requestedBy}`;
  const data = await linearQuery<{
    issueCreate: { success: boolean; issue: { identifier: string; title: string; url: string } | null };
  }>(CREATE_MUTATION, {
    input: {
      teamId: LINEAR.teamId,
      projectId: LINEAR.projectId,
      assigneeId: LINEAR.assigneeId,
      stateId: LINEAR.states[input.state],
      labelIds: [LINEAR.labels[input.label]],
      title: input.title,
      description,
    },
  });
  const issue = data.issueCreate.issue;
  if (!data.issueCreate.success || !issue) throw new Error("Linear non ha creato il ticket");
  return issue;
}
