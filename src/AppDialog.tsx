import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./components";
import { dialogState, type DialogRequest } from "./services/dialogs";

function Prompt({ request }: { request: DialogRequest }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const cancel = () => dialogState.answer(null);
  return (
    <Modal
      title={request.title ?? (request.input ? "修改内容" : "确认操作")}
      className="app-confirm-dialog"
      onClose={cancel}
      dismissOnEscape
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dialogState.answer(request.input ? value : "confirmed");
        }}
      >
        <p className="app-confirm-message" id="app-confirm-description">
          {request.message}
        </p>
        {request.input && (
          <input
            aria-label="输入内容"
            aria-describedby="app-confirm-description"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-dialog-autofocus
          />
        )}
        <div className="actions app-confirm-actions">
          <button type="button" onClick={cancel} data-dialog-autofocus={!request.input || undefined}>
            取消
          </button>
          <button type="submit" className="primary">
            {request.confirmLabel ?? (request.input ? "保存" : "确认继续")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function AppDialog() {
  const request = useSyncExternalStore(
    dialogState.subscribe,
    dialogState.snapshot,
  );
  return request
    ? createPortal(<Prompt request={request} />, document.body)
    : null;
}
