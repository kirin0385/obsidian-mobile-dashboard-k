import { App, Plugin, setIcon } from 'obsidian';
import { ViewUpdate, PluginValue, EditorView, ViewPlugin } from "@codemirror/view";

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后', '可能', '因为', '所以',
    '各位', '谢谢', '由于', '其实', '只要', '目前', '开始', '自己', '就是',
    '需要', '问题', '产生', '使用'
]);

interface SphereNode {
    el: HTMLElement;
    lx: number; ly: number; lz: number; 
    rx: number; ry: number; rz: number; 
    vx: number; vy: number; vz: number; 
    currentScale: number;               
    zRatio: number;
    baseFontSize: number;
    baseWeight: string;
}

// --- 针对文章内部悬浮优化的微型物理引擎 ---
class MiniSphereEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    velocityX = 0.003; // 微核自转稍微快一点，更显灵动
    velocityY = 0.002;
    
    animationFrameId: number = 0;
    isActive = true;
    resizeObserver: any; 

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none'; 
        this.canvas.style.zIndex = '0';
        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();

        const RO = (window as any).ResizeObserver;
        if (RO) {
            this.resizeObserver = new RO(() => this.handleResize());
            this.resizeObserver.observe(this.container);
        }
        
        this.startAnimation();
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    }

    // 实时重构方法：在不打断动画循环的情况下，丝滑替换词汇
    updateWords(words: {word: string, value: number}[]) {
        // 清理旧 DOM
        this.tags.forEach(t => t.el.remove());
        this.tags = [];

        if (words.length === 0) return;

        const maxWordCount = words[0].value;
        const count = Math.min(words.length, 30); // 微型状态只显示前 30 个核心词，防拥挤
        
        const offset = 2 / count; 
        const increment = Math.PI * (3 - Math.sqrt(5));

        for (let i = 0; i < count; i++) {
            const {word, value} = words[i];
            
            const wordEl = document.createElement('div');
            wordEl.innerText = word;
            
            // 字号区间大幅缩小，适应微核空间 (10px - 18px)
            const fontSize = Math.max(10, Math.min(18, 10 + (value/maxWordCount)*8));
            const fontWeight = value > maxWordCount * 0.6 ? '700' : '400'; 

            wordEl.setAttr("style", `
                position: absolute; left: 50%; top: 50%;
                font-family: "SimSun", "STSong", "Songti SC", serif;
                font-size: ${fontSize}px;
                font-weight: ${fontWeight};
                letter-spacing: -0.2px;
                padding: 2px 4px;
                white-space: nowrap;
                user-select: none; pointer-events: none;
                transition: opacity 0.4s ease;
                transform-origin: center center;
                will-change: transform, opacity, filter, color;
                z-index: 10;
            `);
            
            this.container.appendChild(wordEl);

            const y = ((i * offset) - 1) + (offset / 2);
            const r = Math.sqrt(1 - y * y);
            const phi = (i % count) * increment;
            
            const x = Math.cos(phi) * r * this.radius;
            const cy = y * this.radius;
            const z = Math.sin(phi) * r * this.radius;

            this.tags.push({
                el: wordEl,
                lx: x, ly: cy, lz: z,
                rx: x, ry: cy, rz: z, 
                vx: 0, vy: 0, vz: 0,
                currentScale: 1, 
                zRatio: z / this.radius,
                baseFontSize: fontSize,
                baseWeight: fontWeight
            });
        }
    }

    startAnimation() {
        const getComputedColor = (cssVar: string, fallback: string) => {
            const val = getComputedStyle(document.body).getPropertyValue(cssVar).trim();
            return val || fallback;
        };

        const animate = () => {
            if (!this.isActive) return;

            this.ctx.clearRect(0, 0, this.width, this.height);
            const cx = this.width / 2;
            const cy = this.height / 2;

            const colorNormal = getComputedColor('--text-normal', '#333333');
            const neutralLineColor = '128, 128, 128'; 

            this.tags.forEach(tag => {
                const x1 = tag.lx * Math.cos(this.velocityY) - tag.lz * Math.sin(this.velocityY);
                const z1 = tag.lz * Math.cos(this.velocityY) + tag.lx * Math.sin(this.velocityY);
                const y1 = tag.ly * Math.cos(this.velocityX) - z1 * Math.sin(this.velocityX);
                const z2 = z1 * Math.cos(this.velocityX) + tag.ly * Math.sin(this.velocityX);
                tag.lx = x1; tag.ly = y1; tag.lz = z2;
                tag.rx = x1; tag.ry = y1; tag.rz = z2;
                tag.zRatio = z2 / this.radius;
            });

            const renderList = [...this.tags].sort((a, b) => a.rz - b.rz);

            // 绘制后半球连线
            renderList.forEach(item => {
                if (item.rz >= 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            // 中心奇点
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); 
            this.ctx.fillStyle = colorNormal;
            this.ctx.fill();

            // 绘制前半球连线
            renderList.forEach(item => {
                if (item.rz < 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            // 更新 DOM 坐标与景深
            renderList.forEach(item => {
                const tag = item;
                let baseOpacity = 0; let blur = 0; let color = 'var(--text-faint)';
                
                // 光学景深算法
                if (item.zRatio > 0.4) {
                    baseOpacity = 0.9; blur = 0; color = 'var(--text-normal)'; 
                } else if (item.zRatio > 0) {
                    baseOpacity = 0.4 + 0.5 * (item.zRatio / 0.4); blur = 0; color = 'var(--text-muted)'; 
                } else {
                    baseOpacity = 0.08 + 0.32 * ((item.zRatio + 1) / 1); 
                    blur = Math.min(2.0, Math.abs(item.zRatio) * 2.0); color = 'var(--text-faint)';
                }

                const depthScale = 0.7 + 0.4 * ((this.radius + tag.rz) / (2 * this.radius)); 

                const baseTransform = `translate(-50%, -50%) translate3d(${tag.rx}px, ${tag.ry}px, 0px)`;
                tag.el.style.transform = `${baseTransform} scale(${depthScale})`;
                tag.el.style.opacity = baseOpacity.toString();
                tag.el.style.color = color;
                tag.el.style.filter = `blur(${blur}px)`;
                tag.el.style.zIndex = Math.round(tag.rz + this.radius).toString();
            });

            this.animationFrameId = window.requestAnimationFrame(animate);
        };

        animate();
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string) {
        let depthOpacity = 0;
        let depthWidth = 0.3;
        
        if (item.zRatio > 0) {
            depthOpacity = 0.05 + 0.1 * item.zRatio; 
            depthWidth = 0.3 + 0.3 * item.zRatio;
        } else {
            depthOpacity = 0.05 * (1 - Math.abs(item.zRatio)); 
            depthWidth = 0.3;
        }

        if (depthOpacity <= 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.rx, cy + item.ry);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);
        this.ctx.strokeStyle = `rgba(${neutralRGB}, ${depthOpacity})`;
        this.ctx.stroke();
        this.ctx.restore();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) window.cancelAnimationFrame(this.animationFrameId);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.tags.forEach(t => t.el.remove());
        this.canvas.remove();
    }
}

// --- CodeMirror 6 编辑器伴随插件 ---
class InlineTopologyWidget implements PluginValue {
    view: EditorView;
    widgetEl: HTMLElement;
    engine: MiniSphereEngine;
    segmenter: any;
    debounceTimer: NodeJS.Timeout | null = null;
    isVisible = false;

    constructor(view: EditorView) {
        this.view = view;
        
        // 创建悬浮容器 (玻璃拟物化质感)
        this.widgetEl = document.createElement("div");
        this.widgetEl.className = "inline-topology-widget";
        
        // 初始状态隐藏，等待首次计算
        this.widgetEl.style.opacity = '0';
        this.widgetEl.style.transform = 'translateY(10px)';
        
        // 将微核注入编辑器视图底部
        this.view.dom.appendChild(this.widgetEl);
        
        // 初始化微型物理引擎 (半径 65px)
        this.engine = new MiniSphereEngine(this.widgetEl, 65);

        // 初始化分词器
        const IntlAny = (window as any).Intl;
        if (IntlAny && IntlAny.Segmenter) {
            this.segmenter = new IntlAny.Segmenter('zh-CN', { granularity: 'word' });
        }

        // 首次加载立即分析一次
        this.scheduleAnalysis(100);
    }

    // 监听文档所有按键与修改
    update(update: ViewUpdate) {
        if (update.docChanged) {
            // 设置 1500ms 的防抖，即打字停顿 1.5 秒后自动刷新星系
            this.scheduleAnalysis(1500);
        }
    }

    scheduleAnalysis(delay: number) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.analyzeCurrentDocument();
        }, delay);
    }

    analyzeCurrentDocument() {
        // 获取当前正在编辑的整篇文章纯文本
        const rawText = this.view.state.doc.toString();
        const cleanText = rawText
            .replace(/```[\s\S]*?```/g, ' ') 
            .replace(/---[\s\S]*?---/, ' ')  
            .replace(/<[^>]*>?/gm, ' ')      
            .replace(/https?:\/\/[^\s]+/g, ' ') 
            .replace(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g, ' ') 
            .replace(/[0-9a-fA-F]{8,}/g, ' ') 
            .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' '); 

        let segments: any[] = [];
        if (this.segmenter) {
            segments = (Array as any).from(this.segmenter.segment(cleanText));
        } else {
            const fallbackWords = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
            segments = fallbackWords.map((w: string) => ({ segment: w, isWordLike: true }));
        }

        const wordData = new Map<string, number>();

        for (const { segment, isWordLike } of segments) {
            if (!isWordLike) continue; 
            const w = segment.toLowerCase().trim();
            if (STOP_WORDS.has(w)) continue;

            const isChinese = /[\u4e00-\u9fa5]/.test(w);
            if ((isChinese && w.length >= 2) || (!isChinese && w.length >= 3 && w.length <= 20)) {
                wordData.set(w, (wordData.get(w) || 0) + 1);
            }
        }

        const sortedWords = Array.from(wordData.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30) // 微核只展示前 30 个词
                .map(([word, value]) => ({ word, value }));

        if (sortedWords.length > 5) {
            this.engine.updateWords(sortedWords);
            if (!this.isVisible) {
                this.widgetEl.style.opacity = '1';
                this.widgetEl.style.transform = 'translateY(0)';
                this.isVisible = true;
            }
        } else {
            // 词汇太少时不显示，防止空转
            this.widgetEl.style.opacity = '0';
            this.widgetEl.style.transform = 'translateY(10px)';
            this.isVisible = false;
        }
    }

    destroy() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.engine.destroy();
        this.widgetEl.remove();
    }
}

// 包装为 CodeMirror 扩展
const inlineTopologyExtension = ViewPlugin.fromClass(InlineTopologyWidget);

// --- 动态注入 CSS 样式 ---
function injectStyles() {
    const styleId = 'ambient-topology-styles';
    if (document.getElementById(styleId)) return;
    
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
        /* 编辑器内微核专属样式 */
        .inline-topology-widget {
            position: absolute;
            bottom: 30px;
            right: 40px;
            width: 160px;
            height: 160px;
            border-radius: 50%;
            pointer-events: none; /* 穿透鼠标点击，绝不影响写文章 */
            z-index: 100;
            background: radial-gradient(circle at center, var(--background-primary) 0%, transparent 70%);
            transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        /* 当鼠标移动到角落时自动虚化，防止挡住文字 */
        .inline-topology-widget:hover {
            opacity: 0.1 !important;
        }
    `;
    document.head.appendChild(styleEl);
}

export default class AmbientTopologyPlugin extends Plugin {
    async onload() {
        // 1. 注入 CSS 样式
        injectStyles();
        
        // 2. 将核心组件直接注册为编辑器的扩展！
        // 只要你打开任意一篇 Markdown 笔记，这个微核就会自动附着在右下角。
        this.registerEditorExtension(inlineTopologyExtension);
    }
    
    async onunload() { 
        const styleEl = document.getElementById('ambient-topology-styles');
        if (styleEl) styleEl.remove();
    }
}
