export type AuthFlowKind = "signIn" | "signUp";
export type AuthFlowPhase = "idle" | "sending" | "ready" | "verifying" | "cancelled";

export interface AuthFlowState {
  generation: number;
  kind: AuthFlowKind | null;
  phase: AuthFlowPhase;
}

export function newAuthFlow(): AuthFlowState {
  return { generation: 0, kind: null, phase: "idle" };
}

export function beginAuthFlow(previous: AuthFlowState, kind: AuthFlowKind): AuthFlowState {
  return { generation: previous.generation + 1, kind, phase: "sending" };
}

export function transitionAuthFlow(state: AuthFlowState, generation: number, phase: AuthFlowPhase): AuthFlowState {
  return state.generation === generation ? { ...state, phase } : state;
}

export function cancelAuthFlow(state: AuthFlowState): AuthFlowState {
  return { generation: state.generation + 1, kind: null, phase: "cancelled" };
}

export function isCurrentAuthFlow(state: AuthFlowState, generation: number): boolean {
  return state.generation === generation && state.phase !== "cancelled";
}
