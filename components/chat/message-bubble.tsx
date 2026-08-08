import { ExternalLink, Flame, MessageSquareHeart, RefreshCw, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type BaseMessage, Role } from "../../lib/chat-engine";
import { useChatStore } from "../../lib/chat.store";
import { resolveMediaUrl } from "../../lib/media-resolver";
import { PlayAudioButton } from "./play-audio-button";

const THOUGHT_REGEX = /<thought>([\s\S]*?)<\/thought>/g;

interface MessageBubbleProps {
    msg: BaseMessage;
    isLast: boolean;
    isContinuous: boolean; // 是否与上一条同属一个人
    avatarUrl?: string; // 如果不传，就不显示头像（群聊里自己一般不显示，对方才显示）
    displayName?: string; // 如果传了且对方，气泡上方显示名字
}

/**
 * 通用渲染器组件，用来在小手机上绘制纯文本气泡、系统提示、图片、外链卡片等。
 * 这个组件不耦合具体的角色卡或 API 请求逻辑，只处理 UI 展示。
 */
export const MessageBubble = memo(function MessageBubble({
    msg,
    isLast,
    isContinuous,
    avatarUrl,
    displayName,
}: MessageBubbleProps) {
    const isUser = msg.role === Role.USER;
    const isSystem = msg.role === Role.SYSTEM;

    const { openContextMenu } = useChatStore();
    const handleContextMenu = (e: React.ContextMenuEvent | React.TouchEvent | React.MouseEvent) => {
        // 阻止默认右键菜单
        if (e.type === "contextmenu") {
            e.preventDefault();
        }
        // 如果是左键点击，不触发（由长按处理）
        if (e.type === "mousedown" && (e as React.MouseEvent).button === 0) {
            return;
        }
        
        let clientX, clientY;
        if ("touches" in e) {
            // TouchEvent
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            // MouseEvent
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }
        
        openContextMenu(msg.id, { x: clientX, y: clientY });
    };

    // 系统消息单独渲染
    if (isSystem) {
        return (
            <div className="flex justify-center my-4 opacity-50 px-8">
                <div 
                    className="text-xs text-center bg-[var(--ui-bg-elevated)] px-3 py-1 rounded-full whitespace-pre-wrap select-text cursor-context-menu"
                    onContextMenu={handleContextMenu}
                >
                    {msg.content}
                </div>
            </div>
        );
    }

    const { content, attachments } = msg;

    // 分离出内部思考标签
    let displayContent = content;
    const thoughts: string[] = [];
    
    // 如果包含 <thought> 标签，将其分离
    if (displayContent.includes("<thought>")) {
        const matches = [...displayContent.matchAll(THOUGHT_REGEX)];
        for (const match of matches) {
            thoughts.push(match[1].trim());
        }
        // 从正文中移除所有的 thought 块
        displayContent = displayContent.replace(THOUGHT_REGEX, "").trim();
    }

    // 处理扩展前缀（例如【旁白】、【好感度提升】）
    let prefixCard = null;
    if (displayContent.startsWith("【")) {
        const endIdx = displayContent.indexOf("】");
        if (endIdx > 0 && endIdx < 20) { // 限制前缀长度，避免误判
            const prefix = displayContent.substring(1, endIdx);
            displayContent = displayContent.substring(endIdx + 1).trim();
            
            // 简单的关键词匹配决定颜色/图标
            let icon = <MessageSquareHeart size={14} />;
            let bgClass = "bg-primary/10 text-primary";
            
            if (prefix.includes("旁白") || prefix.includes("系统")) {
                icon = <RefreshCw size={14} className="text-gray-500" />;
                bgClass = "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
            } else if (prefix.includes("好感") || prefix.includes("喜欢")) {
                icon = <Flame size={14} className="text-pink-500" />;
                bgClass = "bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400";
            }
            
            prefixCard = (
                <div className={`text-xs px-2 py-1 rounded mb-1 flex items-center gap-1.5 w-fit ${bgClass}`}>
                    {icon}
                    <span>{prefix}</span>
                </div>
            );
        }
    }

    // 检查是否包含扫码支付链接
    const scanPayMatches = [...displayContent.matchAll(PAY_SCHEME_RE)];
    const payUrls = scanPayMatches.map(m => m[0]);
    if (payUrls.length > 0) {
        displayContent = displayContent.replace(PAY_SCHEME_RE, "").trim();
    }

    // 处理链接、引号等 Markdown 渲染准备
    const processedContent = wrapQuotedDialogue(linkifyBareUrls(displayContent));

    return (
        <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"} ${isContinuous ? "mt-1" : "mt-4"} group`}>
            {/* 对方头像（连续消息时占位但不显示） */}
            {!isUser && (
                <div className="w-10 h-10 flex-shrink-0 mr-2 flex flex-col justify-end">
                    {!isContinuous && avatarUrl && (
                        <img 
                            src={avatarUrl} 
                            alt={displayName || "Avatar"} 
                            className="w-10 h-10 rounded-full object-cover shadow-sm bg-[var(--ui-bg-elevated)]"
                            onError={(e) => {
                                // @ts-ignore
                                e.target.style.display = 'none';
                            }}
                        />
                    )}
                </div>
            )}

            <div className={`flex flex-col max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
                {/* 对方名字 */}
                {!isUser && !isContinuous && displayName && (
                    <div className="text-xs opacity-50 ml-1 mb-1">{displayName}</div>
                )}

                {/* 前缀卡片 */}
                {prefixCard}

                {/* 媒体附件区 */}
                {attachments && attachments.length > 0 && (
                    <div className="flex flex-col gap-2 mb-2 w-full">
                        {attachments.map((att, i) => (
                            <MediaAttachmentView key={i} attachment={att} />
                        ))}
                    </div>
                )}

                {/* 内部思考区（折叠） */}
                {thoughts.length > 0 && (
                    <div className="mb-2 w-full">
                        {thoughts.map((thought, i) => (
                            <ThoughtBlock key={i} content={thought} />
                        ))}
                    </div>
                )}

                {/* 扫码支付卡片 */}
                {payUrls.length > 0 && (
                    <div className="flex flex-col gap-2 mb-2 w-full">
                        {payUrls.map((url, i) => (
                            <ScanPayCard key={i} url={url} />
                        ))}
                    </div>
                )}

                {/* 正文气泡 */}
                {processedContent && (
                    <div 
                        className={`
                            relative px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed break-words shadow-sm
                            cursor-context-menu select-text transition-colors
                            ${isUser 
                                ? "bg-[var(--chat-bubble-user)] text-[var(--chat-text-user)] rounded-tr-sm" 
                                : "bg-[var(--chat-bubble-ai)] text-[var(--chat-text-ai)] rounded-tl-sm"
                            }
                            ${msg.isStreaming ? "animate-pulse" : ""}
                        `}
                        onContextMenu={handleContextMenu}
                        // 长按支持
                        onTouchStart={(e) => {
                            const timer = setTimeout(() => {
                                handleContextMenu(e);
                            }, 500);
                            // @ts-ignore
                            e.target.dataset.longPressTimer = timer;
                        }}
                        onTouchEnd={(e) => {
                            // @ts-ignore
                            clearTimeout(e.target.dataset.longPressTimer);
                        }}
                        onTouchMove={(e) => {
                            // @ts-ignore
                            clearTimeout(e.target.dataset.longPressTimer);
                        }}
                    >
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={MARKDOWN_COMPONENTS}
                        >
                            {processedContent}
                        </ReactMarkdown>

                        {/* 悬浮的播放按钮（如果有语音） */}
                        {msg.audioUrl && (
                            <div className={`absolute -bottom-3 ${isUser ? "-left-3" : "-right-3"} z-10`}>
                                <PlayAudioButton url={msg.audioUrl} />
                            </div>
                        )}
                        
                        {/* 正在生成时的光标 */}
                        {msg.isStreaming && isLast && (
                            <span className="inline-block w-1.5 h-4 ml-1 bg-current animate-pulse align-middle opacity-70 rounded-full" />
                        )}
                    </div>
                )}
                
                {/* 如果只有语音没有正文（极少数情况） */}
                {!processedContent && msg.audioUrl && (
                    <div className="relative z-10 mt-1">
                        <PlayAudioButton url={msg.audioUrl} />
                    </div>
                )}
            </div>

            {/* 自己的头像占位（这里省略实际头像，微信自己发消息一般不带头像或在最右） */}
            {isUser && (
                <div className="w-2 h-10 flex-shrink-0 ml-1" />
            )}
        </div>
    );
});

// ==========================================
// 子组件：媒体附件渲染
// ==========================================
function MediaAttachmentView({ attachment }: { attachment: BaseMessage["attachments"][0] }) {
    if (attachment.type.startsWith("image/")) {
        return (
            <div className="relative rounded-lg overflow-hidden border border-black/5 dark:border-white/10 shadow-sm max-w-full">
                <img 
                    src={resolveMediaUrl(attachment.url)} 
                    alt="attachment" 
                    className="max-w-full h-auto max-h-[300px] object-contain bg-black/5 dark:bg-white/5"
                    onClick={() => {
                        // 简单的全屏预览，实际产品中应调用全局图片查看器
                        const w = window.open("");
                        if (w) {
                            w.document.write(`<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${resolveMediaUrl(attachment.url)}" style="max-width:100%;max-height:100%;object-fit:contain;"></body>`);
                        }
                    }}
                />
            </div>
        );
    }
    
    if (attachment.type.startsWith("audio/")) {
        return (
            <audio 
                controls 
                src={resolveMediaUrl(attachment.url)} 
                className="max-w-full h-10 rounded-full shadow-sm"
            />
        );
    }
    
    // 其他文件类型显示为卡片
    return (
        <a 
            href={resolveMediaUrl(attachment.url)} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-xl bg-[var(--ui-bg-elevated)] border border-[var(--ui-border)] shadow-sm max-w-full hover:bg-[var(--ui-bg-hover)] transition-colors"
        >
            <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <ExternalLink size={20} />
            </div>
            <div className="overflow-hidden">
                <div className="text-sm font-medium truncate">
                    {attachment.name || "未知文件"}
                </div>
                <div className="text-xs opacity-50 truncate mt-0.5">
                    {attachment.type || "未知格式"}
                </div>
            </div>
        </a>
    );
}

// ==========================================
// 子组件：内部思考块折叠面板
// ==========================================
function ThoughtBlock({ content }: { content: string }) {
    const [expanded, setExpanded] = useState(false);
    
    return (
        <div className="border border-[var(--ui-border)] rounded-xl overflow-hidden bg-[var(--ui-bg-elevated)]/50 backdrop-blur-sm shadow-sm transition-all duration-300">
            <button 
                onClick={() => setExpanded(!expanded)}
                className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium opacity-70 hover:opacity-100 hover:bg-[var(--ui-bg-hover)] transition-colors"
            >
                <span className="flex items-center gap-1.5">
                    <RefreshCw size={12} className={expanded ? "animate-spin-slow" : ""} />
                    内部思考过程
                </span>
                <span className="text-[10px] bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">
                    {expanded ? "收起" : "展开"}
                </span>
            </button>
            
            <div 
                className={`
                    text-[13px] leading-relaxed opacity-80 px-3 overflow-hidden transition-all duration-300 ease-in-out
                    ${expanded ? "max-h-[500px] py-2 border-t border-[var(--ui-border)] overflow-y-auto" : "max-h-0 py-0"}
                `}
            >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    );
}

// ==========================================
// 子组件：扫码支付卡片
// ==========================================
function ScanPayCard({ url }: { url: string }) {
    // 简单的二维码占位，实际应用中可以引入 qrcode.react
    const isWechat = url.toLowerCase().includes("weixin") || url.toLowerCase().includes("wechat");
    const isAlipay = url.toLowerCase().includes("alipay");
    
    let typeName = "扫码支付";
    let colorClass = "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800";
    
    if (isAlipay) {
        typeName = "支付宝";
        colorClass = "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800";
    } else if (isWechat) {
        typeName = "微信支付";
    }

    return (
        <div className={`p-4 rounded-xl border flex flex-col items-center gap-3 shadow-sm ${colorClass}`}>
            <div className="text-sm font-medium">请使用{typeName}扫码</div>
            
            <div className="w-32 h-32 bg-white rounded-lg p-2 shadow-inner flex items-center justify-center relative">
                {/* 此处用一个简化的图案代替二维码 */}
                <div className="w-full h-full border-4 border-current rounded-sm relative">
                    <div className="absolute top-1 left-1 w-4 h-4 bg-current" />
                    <div className="absolute top-1 right-1 w-4 h-4 bg-current" />
                    <div className="absolute bottom-1 left-1 w-4 h-4 bg-current" />
                    <div className="absolute bottom-1 right-1 w-3 h-3 bg-current rounded-full" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-bold opacity-30">
                        {isWechat ? "WeChat" : isAlipay ? "Alipay" : "Pay"}
                    </div>
                </div>
            </div>
            
            <div className="flex w-full gap-2 mt-1">
                <a 
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center text-xs py-1.5 rounded-full bg-white/50 hover:bg-white/80 dark:bg-black/20 dark:hover:bg-black/40 transition-colors"
                >
                    尝试打开App
                </a>
                <button 
                    onClick={() => {
                        navigator.clipboard.writeText(url);
                        // 理想情况这里应该有个 toast
                    }}
                    className="flex-1 text-center text-xs py-1.5 rounded-full bg-white/50 hover:bg-white/80 dark:bg-black/20 dark:hover:bg-black/40 transition-colors"
                >
                    复制链接
                </button>
            </div>
        </div>
    );
}

// ==========================================
// 工具函数：Markdown 文本预处理
// ==========================================

function mapMarkdownOutsideCode(text: string, mapper: (segment: string) => string): string {
    const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    return parts.map(part => part.startsWith("\`") ? part : mapper(part)).join("");
}

/**
 * 浏览器无法直接打开的支付类 scheme（微信 Native 扫码付、支付宝等）。
 * 命中后在气泡里渲染 ScanPayCard（二维码 + 在钱包中打开 + 复制），并从正文里剥掉这串。
 */
const PAY_SCHEME_RE = /(?:weixin|wechat|alipays|alipay):\/\/[^\s<>"'\`()\]，。！？、；]+/gi;

/**
 * 把对话中的成对引号包裹进 <q> 标签，配合 CSS 实现独立样式（如异色、高亮）。
 * - 支持中文弯引号 “…”、直角引号 「…」、英文直引号 "…"（同一行内成对才包）
 * - 默认无视觉变化（chat.css 已关掉 q 的浏览器默认引号），仅当用户 CSS 写了 q {} 才生效
 */
function wrapQuotedDialogue(text: string): string {
    return mapMarkdownOutsideCode(text, segment =>
        segment.split(/(<[^>]*>)/g).map(part => {
            if (part.startsWith("<")) return part;
            return part
                .replace(/“([^”\n]+)”/g, "<q>“$1”</q>")
                .replace(/「([^」\n]+)」/g, "<q>「$1」</q>")
                .replace(/"([^"\n]+)"/g, "<q>\\\"$1\\\"</q>");
        }).join(""),
    );
}

function linkifyBareUrls(text: string): string {
    return mapMarkdownOutsideCode(text, segment => {
        const normalized = segment.replace(
            /https?:\/\/[^\s<>"'\`]+(?:\s*[?&]\s*[^\s<>"'\`]+)*/g,
            match => match.replace(/\s+/g, ""),
        );
        return normalized.replace(/https?:\/\/[^\s<>"'\`()[\]]+/g, (url, offset, source) => {
            const prev = source[offset - 1];
            if (prev === "[" || prev === "(" || prev === "<" || prev === "=" || prev === "\\\"" || prev === "'") return url;

            const trailing = url.match(/[),.;!?，。！？、]+$/)?.[0] || "";
            const href = trailing ? url.slice(0, -trailing.length) : url;
            return \`[\${href}](\${href})\${trailing}\`;
        });
    });
}

const MARKDOWN_COMPONENTS = {
    p: ({ node, className, ...props }: any) => (
        <div
            className={["chat-markdown-paragraph", className].filter(Boolean).join(" ")}
            {...props}
        />
    ),
    li: ({ node, ...props }: any) => <li {...props} />,
    blockquote: ({ node, ...props }: any) => <blockquote {...props} />,
    a: ({ node, ...props }: any) => (
        <a {...props} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" />
    ),
    // 对于 img，阻止默认右键菜单，避免与气泡右键冲突
    img: ({ node, ...props }: any) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img {...props} className="max-w-full rounded" onContextMenu={(e) => e.preventDefault()} />
    ),
};