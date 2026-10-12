import { useMutation, useQueryClient } from "@tanstack/react-query";
import { questionsApi } from "../questionsApi.js";

export function RetryJob({ cvId }: { cvId: string }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => questionsApi.retry(cvId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cv", cvId] }),
  });
  return (
    <>
      <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
        Try again
      </button>
      {retry.isError && (
        <p className="error" role="alert">
          {retry.error.message}
        </p>
      )}
    </>
  );
}
