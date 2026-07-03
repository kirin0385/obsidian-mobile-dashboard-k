import { App, Plugin, TFile } from 'obsidian';

const STOP_WORDS = new Set([
    '因此', '通过', '可以', '一个', '没有', '我们', '什么', '这个', '如果是', 
    '怎么', '如果', '可以说', '这样', '很多', '非常', '进行', '然后', '可能', 
    '因为', '所以', '各位', '谢谢', '由于', '其实', '只要', '目前', '开始', 
    '自己', '就是', '需要', '问题', '产生', '使用', '发现', '这种', '那些',
    '也是', '一样', '知道', '觉得', '时候'
]);

const FALLBACK_WORDS = [
    {word: '液冷技术', value: 10}, {word: '热管理', value: 9}, {word: '自动化', value: 9},
    {word: '系统架构', value: 8}, {word: '储能', value: 8}, {word: '服务器', value: 7},
    {word: '工作流', value: 7}, {word: '数据分析', value: 6}, {word: '性能测试', value: 6},
    {word: '核心控制', value: 5}, {word: '结构设计', value: 5}, {word: '新能源', value: 5},
    {word: '效率优化', value: 4}, {word: '解决方案', value: 4}, {word: '精密加工', value: 4},
    {word: '工艺', value: 3}, {word: '节点', value: 3}, {word: '策略', value: 3},
    {word: '矩阵', value: 2}, {word: '参数', value: 2}, {word: '模型', value: 2}
];

interface SphereNode {
    el: HTMLElement;
    lx: number; ly: number; lz: number;
    zRatio: number;
    x2d: number; y2d: number; // 缓存 2D 投影坐标
}

// 性能优化：CSS 变量缓存
let cssVars = {
    textNormal: '#333333',
    textMuted: '#666666',
    textFaint: '#999999'
};

// --- 移动端专属：纯装饰级极简物理引擎 ---
class WordSphereDecorativeEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    velocityX = 0.0025; 
    velocityY = 0.0025;

    animationFrameId: number = 0;
    isActive = true;
    
    // 核心视觉重心偏移：不改DOM导致跳动，直接在渲染层将画面往下推！
    visualOffsetY = 15; 

    // 丝滑优化：离屏 Canvas 预渲染 + 帧间隔控制
    private frameCount = 0;
    private targetFPS = 60;
    private frameInterval = 1000 / 60;
    private lastFrameTime = 0;

    // 缓存样式字符串，减少 DOM 操作
    private styleCache = new Map<HTMLElement, string>();

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.willChange = 'transform';
        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d', { alpha: true });
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();

        const RO = (window as any).ResizeObserver;
        if (RO) {
            const observer = new RO(() => this.handleResize());
            observer.observe(this.container);
        }

        // 预获取 CSS 变量
        this.updateCssVars();
    }

    private updateCssVars() {
        const style = getComputedStyle(document.body);
        cssVars.textNormal = style.getPropertyValue('--text-normal').trim() || '#333333';
        cssVars.textMuted = style.getPropertyValue('--text-muted').trim() || '#666666';
        cssVars.textFaint = style.getPropertyValue('--text-faint').trim() || '#999999';
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const safeRadiusWidth = (rect.width / 2) - 20; 
        const safeRadiusHeight = (rect.height / 2) - 20;
        let newRadius = Math.min(safeRadiusWidth, safeRadiusHeight);
        newRadius = Math.max(newRadius, 40); 

        if (this.radius > 0 && this.tags.length > 0 && this.radius !== newRadius) {
            const scaleFactor = newRadius / this.radius;
            this.tags.forEach(tag => {
                tag.lx *= scaleFactor;
                tag.ly *= scaleFactor;
                tag.lz *= scaleFactor;
            });
        }
        
        this.radius = newRadius;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    }

    addTag(tagEl: HTMLElement) {
        tagEl.style.position = 'absolute';
        tagEl.style.left = '50%';
        tagEl.style.top = '50%';
        // 优化：使用 translate3d 强制 GPU 加速
        tagEl.style.willChange = 'transform, opacity';
        tagEl.style.zIndex = '10';
        // 预设置 GPU 优化属性
        tagEl.style.backfaceVisibility = 'hidden';
        tagEl.style.perspective = '1000px';
        
        this.tags.push({
            el: tagEl,
            lx: 0, ly: 0, lz: 0,
            zRatio: 0,
            x2d: 0, y2d: 0
        });
        
        this.container.appendChild(tagEl);
    }

    initPositions() {
        const total = this.tags.length;
        if (total === 0) return;
        
        const offset = 2 / total; 
        const increment = Math.PI * (3 - Math.sqrt(5));
        
        this.tags.forEach((tag, i) => {
            const y = ((i * offset) - 1) + (offset / 2);
            const r = Math.sqrt(1 - y * y);
            const phi = i * increment;
            
            tag.lx = Math.cos(phi) * r * this.radius;
            tag.ly = y * this.radius;
            tag.lz = Math.sin(phi) * r * this.radius;
            tag.zRatio = tag.lz / this.radius;
        });
    }

    startAnimation() {
        if (this.tags.length === 0) return;
        
        this.initPositions();
        this.updateCssVars();

        const animate = (timestamp: number) => {
            if (!this.isActive) return;

            // 帧率控制
            const elapsed = timestamp - this.lastFrameTime;
            if (elapsed < this.frameInterval) {
                this.animationFrameId = window.requestAnimationFrame(animate);
                return;
            }
            this.lastFrameTime = timestamp - (elapsed % this.frameInterval);

            const cx = this.width / 2;
            const cy = (this.height / 2) + this.visualOffsetY;

            // 3D 旋转计算（原地操作，避免创建新对象）
            const cosY = Math.cos(this.velocityY);
            const sinY = Math.sin(this.velocityY);
            const cosX = Math.cos(this.velocityX);
            const sinX = Math.sin(this.velocityX);

            this.tags.forEach(tag => {
                const x1 = tag.lx * cosY - tag.lz * sinY;
                const z1 = tag.lz * cosY + tag.lx * sinY;
                const y1 = tag.ly * cosX - z1 * sinX;
                const z2 = z1 * cosX + tag.ly * sinX;
                tag.lx = x1; tag.ly = y1; tag.lz = z2;
                tag.zRatio = z2 / this.radius;
                // 缓存 2D 投影
                tag.x2d = tag.lx;
                tag.y2d = tag.ly;
            });

            // 优化：仅当需要时清除 Canvas
            this.ctx.clearRect(0, 0, this.width, this.height);

            // 绘制连线（使用缓存的坐标）
            const neutralLineColor = '128, 128, 128';
            const backItems: SphereNode[] = [];
            const frontItems: SphereNode[] = [];
            
            this.tags.forEach(tag => {
                if (tag.lz >= 0) {
                    frontItems.push(tag);
                } else {
                    backItems.push(tag);
                }
            });

            // 绘制后方连线
            backItems.forEach(item => {
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            // 绘制中心点
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 2, 0, Math.PI * 2);
            this.ctx.fillStyle = cssVars.textNormal;
            this.ctx.fill();

            // 绘制前方连线
            frontItems.forEach(item => {
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            // DOM 渲染（批量处理，减少重排）
            const radius2 = this.radius * 2;
            this.tags.forEach(tag => {
                const tagEl = tag.el;
                let baseOpacity: number; let blur: number; let color: string;
                
                const zr = tag.zRatio;
                if (zr > 0.4) {
                    baseOpacity = 0.9; blur = 0; color = cssVars.textNormal;
                } else if (zr > 0) {
                    baseOpacity = 0.4 + 0.5 * (zr / 0.4); blur = 0; color = cssVars.textMuted;
                } else {
                    baseOpacity = 0.1 + 0.3 * ((zr + 1) / 1);
                    blur = Math.min(2.0, Math.abs(zr) * 2.0); color = cssVars.textFaint;
                }

                const depthScale = 0.6 + 0.5 * ((this.radius + tag.lz) / radius2);
                
                // 优化：使用 translate3d + 计算属性
                const transform = `translate3d(-50%, -50%, 0) translate3d(${tag.x2d}px, ${tag.y2d + this.visualOffsetY}px, 0) scale(${depthScale})`;
                
                // 样式批量更新
                tagEl.style.transform = transform;
                tagEl.style.opacity = baseOpacity.toString();
                tagEl.style.color = color;
                tagEl.style.filter = blur > 0 ? `blur(${blur}px)` : '';
                tagEl.style.zIndex = Math.round(tag.lz + this.radius).toString();
            });

            this.animationFrameId = window.requestAnimationFrame(animate);
        };

        this.animationFrameId = window.requestAnimationFrame(animate);
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string) {
        const zr = item.zRatio;
        let depthOpacity = 0;
        let depthWidth = 0.3;
        
        if (zr > 0) {
            depthOpacity = 0.05 + 0.12 * zr;
            depthWidth = 0.3 + 0.3 * zr;
        } else {
            depthOpacity = 0.05 * (1 - Math.abs(zr));
            depthWidth = 0.3;
        }

        if (depthOpacity <= 0) return;

        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.x2d, cy + item.y2d);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);
        this.ctx.strokeStyle = `rgba(${neutralRGB}, ${depthOpacity})`;
        this.ctx.stroke();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) window.cancelAnimationFrame(this.animationFrameId);
    }
}

async function analyzeDecorativeData(app: App) {
    try {
        const files = app.vault.getMarkdownFiles();
        if (files.length === 0) return FALLBACK_WORDS;

        const largestFiles = files.sort((a, b) => b.stat.size - a.stat.size).slice(0, 20);
        const wordData = new Map<string, number>();

        for (const file of largestFiles) {
            const content = await app.vault.cachedRead(file);
            const matches = content.match(/[\u4e00-\u9fa5]{2,5}/g) || [];
            
            for (const w of matches) {
                if (STOP_WORDS.has(w)) continue;
                wordData.set(w, (wordData.get(w) || 0) + 1);
            }
        }

        const results = Array.from(wordData.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 32) 
            .map(([word, value]) => ({ word, value }));

        if (results.length < 15) return FALLBACK_WORDS;
        return results;
    } catch (e) {
        return FALLBACK_WORDS;
    }
}

export default class MobileStatsPlugin extends Plugin {
    sphereEngine: WordSphereDecorativeEngine | null = null;
    injectedContainer: HTMLElement | null = null;
    cachedWords: {word: string, value: number}[] | null = null;
    
    // 丝滑驻留的核心监听器
    mutationObserver: MutationObserver | null = null;
    currentObserverTarget: HTMLElement | null = null;

    async onload() {
        this.app.workspace.onLayoutReady(async () => {
            this.cachedWords = await analyzeDecorativeData(this.app);
            this.observeAndInject();
        });

        // 监听视图变动，确保随时附着
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.observeAndInject();
        }));
        
        // 当打开新文件时，同样极速重置检查
        this.registerEvent(this.app.workspace.on('file-open', () => {
            this.observeAndInject();
        }));
    }
    
    async onunload() { 
        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();
        if (this.mutationObserver) this.mutationObserver.disconnect();
        this.cachedWords = null;
    }
    
    // 零延迟自愈构建方法
    observeAndInject() {
        try {
            const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
            if (fileExplorerLeaves.length === 0) return; 

            const fileExplorerContainer = fileExplorerLeaves[0].view.containerEl;
            const navContainer = fileExplorerContainer.querySelector('.nav-files-container') as HTMLElement;
            if (!navContainer) return;

            // 1. 如果还没构建寄生体，直接构建
            if (!this.injectedContainer) {
                this.buildContainer(navContainer);
            }

            // 2. 如果寄生体不在树里，瞬间补齐
            if (!navContainer.contains(this.injectedContainer!)) {
                navContainer.appendChild(this.injectedContainer!);
            }

            // 3. 开启基因级锁死：只要 Obsidian 敢删，瞬间原样粘回去（0帧延迟）
            if (this.currentObserverTarget !== navContainer) {
                if (this.mutationObserver) this.mutationObserver.disconnect();
                
                this.mutationObserver = new MutationObserver(() => {
                    if (this.injectedContainer && !navContainer.contains(this.injectedContainer)) {
                        navContainer.appendChild(this.injectedContainer);
                    }
                });
                
                // 监听子节点的任何增删动作
                this.mutationObserver.observe(navContainer, { childList: true });
                this.currentObserverTarget = navContainer;
            }

        } catch (e) {
            console.error("Topology Observer Error: ", e);
        }
    }

    // 独立出构建 UI 的方法，只在插件最初加载时跑一次
    buildContainer(navContainer: HTMLElement) {
        if (this.sphereEngine) this.sphereEngine.destroy();

        this.injectedContainer = document.createElement('div');
        this.injectedContainer.className = 'mobile-parasitic-heatmap';
        
        // 恢复最纯净、无任何跳动隐患的 CSS
        this.injectedContainer.setAttribute('style', `
            width: 100%;
            height: 240px; 
            margin: 15px 0;
            display: flex;
            flex-shrink: 0; 
            justify-content: center;
            align-items: center;
            position: relative;
            background-color: transparent;
            pointer-events: none;
        `);

        const heatmapDiv = this.injectedContainer.createDiv({ 
            attr: { style: 'width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;' } 
        });

        navContainer.appendChild(this.injectedContainer);
        
        const heatmapWords = this.cachedWords || FALLBACK_WORDS;
        if (heatmapWords.length === 0) return;

        const maxWordCount = heatmapWords[0].value;
        const baseRadius = Math.max((heatmapDiv.clientWidth / 2) * 0.75, 55); 

        this.sphereEngine = new WordSphereDecorativeEngine(heatmapDiv, baseRadius);

        heatmapWords.forEach(({word, value}) => {
            const wordEl = document.createElement('div');
            wordEl.innerText = word;
            
            const fontSize = Math.max(11, Math.min(21, 11 + (value/maxWordCount)*10));
            const fontWeight = value > maxWordCount * 0.5 ? '700' : '400'; 

            wordEl.setAttr("style", `
                font-family: "SimSun", "STSong", "Songti SC", serif;
                font-size: ${fontSize}px;
                font-weight: ${fontWeight};
                letter-spacing: 0.5px;
                white-space: nowrap;
                user-select: none;
                transform-origin: center center;
            `);
            
            this.sphereEngine!.addTag(wordEl);
        });

        this.sphereEngine.startAnimation();
    }
}
