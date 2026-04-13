"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, ImageIcon } from "lucide-react";
import { imagesAPI } from "@/lib/api";

interface ImageUploaderProps {
    jobId: string;
    phase: "BEFORE" | "AFTER" | "PART";
    label: string;
    description?: string;
    onUploaded?: (images: ImageRecord[]) => void;
    existingImages?: ImageRecord[];
}

interface ImageRecord {
    id: string;
    url: string;
    phase: string;
    caption?: string;
}

export default function ImageUploader({ jobId, phase, label, description, onUploaded, existingImages = [] }: ImageUploaderProps) {
    const [uploading, setUploading] = useState(false);
    const [images, setImages] = useState<ImageRecord[]>(existingImages);
    const [error, setError] = useState("");

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (!acceptedFiles.length) return;
        setUploading(true);
        setError("");
        try {
            const formData = new FormData();
            formData.append("jobId", jobId);
            formData.append("phase", phase);
            acceptedFiles.forEach(f => formData.append("images", f));

            const res = await imagesAPI.upload(formData);
            const newImages = [...images, ...res.data];
            setImages(newImages);
            onUploaded?.(newImages);
        } catch {
            setError("Upload failed. Please try again.");
        } finally {
            setUploading(false);
        }
    }, [jobId, phase, images, onUploaded]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop, accept: { "image/*": [] }, maxFiles: 10, disabled: uploading,
    });

    const removeImage = async (imageId: string, imageUrl: string) => {
        try {
            await imagesAPI.delete(imageId);
            const updated = images.filter(img => img.id !== imageId);
            setImages(updated);
            onUploaded?.(updated);
        } catch {
            // Check if just not yet persisted (optimistic)
            const updated = images.filter(img => img.url !== imageUrl);
            setImages(updated);
            onUploaded?.(updated);
        }
    };

    const phaseColors: Record<string, string> = {
        BEFORE: "border-amber-500/30 bg-amber-500/5",
        AFTER: "border-emerald-500/30 bg-emerald-500/5",
        PART: "border-blue-500/30 bg-blue-500/5",
    };

    return (
        <div className={`rounded-xl border ${phaseColors[phase] || "border-white/10"} p-4`}>
            <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-200">{label}</span>
                {images.length > 0 && (
                    <span className="badge badge-blue ml-auto">{images.length} photo{images.length !== 1 ? "s" : ""}</span>
                )}
            </div>
            {description && <p className="text-xs text-slate-500 mb-3">{description}</p>}

            {/* Drop zone */}
            <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all duration-200 ${isDragActive ? "border-blue-400 bg-blue-500/10" : "border-white/15 hover:border-white/30 hover:bg-white/5"} ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
                <input {...getInputProps()} />
                <Upload className="w-5 h-5 text-slate-500 mx-auto mb-2" />
                <p className="text-xs text-slate-500">
                    {isDragActive ? "Drop images here…" : uploading ? "Uploading…" : "Drag & drop or click to upload"}
                </p>
            </div>

            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

            {/* Image previews */}
            {images.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                    {images.map((img, i) => (
                        <div key={img.id || i} className="relative group rounded-lg overflow-hidden aspect-square bg-black/30">
                            <img
                                src={`http://localhost:5001${img.url}`}
                                alt={img.caption || `Image ${i + 1}`}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <button
                                    onClick={() => removeImage(img.id, img.url)}
                                    className="w-7 h-7 rounded-full bg-red-500/80 flex items-center justify-center hover:bg-red-500"
                                >
                                    <X className="w-3 h-3 text-white" />
                                </button>
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                                <p className="text-[10px] text-white/70 truncate">{img.caption || `Photo ${i + 1}`}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
