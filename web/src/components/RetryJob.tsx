import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { SAVE_FIRST } from "./QuestionsPanel.js";

export function RetryJob({ cvId, blocked }: { cvId: string; blocked: boolean }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.retry(cvId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cv", cvId] }),
  });
  return (
    <>
      <button type="button" disabled={blocked || retry.isPending} onClick={() => retry.mutate()}>
        Try again
      </button>
      {blocked && <p className="muted">{SAVE_FIRST}</p>}
      {retry.isError && (
        <p className="error" role="alert">
          {retry.error.message}
        </p>
      )}
    </>
  );
}
