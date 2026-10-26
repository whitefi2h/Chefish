import { useState } from "react";
import { Plus, Minus, Scan } from "lucide-react";
import { Modal } from "./components";
export default function ImageViewer({
  image,
  title,
  onClose,
}: {
  image: string;
  title: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="image-viewer"
      dismissOnEscape
    >
      <div className="viewer-controls">
        <button
          type="button"
          aria-label="缩小图片"
          disabled={zoom <= 1}
          onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="放大图片"
          disabled={zoom >= 4}
          onClick={() => setZoom((v) => Math.min(4, v + 0.5))}
        >
          <Plus size={16} />
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          <Scan size={15} />
          适应窗口
        </button>
      </div>
      <div className="viewer-stage">
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          <img src={image} alt={title} />
        </div>
      </div>
    </Modal>
  );
}
