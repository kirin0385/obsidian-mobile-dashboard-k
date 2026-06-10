import { App, Plugin, TFile } from 'obsidian';

const STOP_WORDS = new Set([
    '因此', '通过', '可以', '一个', '没有', '我们', '什么', '这个', '如果是', 
    '怎么', '如果', '可以说', '这样', '很多', '非常', '进行', '然后', '可能', 
    '因为', '所以', '各位', '谢谢', '由于', '其实', '只要', '目前', '开始', 
    '自己', '就是', '需要', '问题', '产生', '使用', '发现', '这种', '那些',
    '也是', '一样', '知道', '觉得', '时候'
]);

// 绝对保底文案：即使扫描出错，也绝不允许白屏
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
}

// --- 移动端专属：纯装饰级极简物理引擎 (零交互、纯匀速) ---
class WordSphereDecorativeEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    // 自然匀速滚动
    velocityX = 0.0025; 
    velocityY = 0.0025;

    animationFrameId: number = 0;
    isActive = true;

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();

        const RO = (window as any).ResizeObserver;
        if (RO) {
            const observer = new RO(() => this.handleResize());
            observer.observe(this.container);
        }
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
        tagEl.style.willChange = 'transform, opacity, filter, color';
        tagEl.style.zIndex = '10'; 
        
        this.tags.push({
            el: tagEl,
            lx: 0, ly: 0, lz: 0, 
            zRatio: 0,
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
                tag.zRatio = z2 / this.radius;
            });

            const renderList = [...this.tags].sort((a, b) => a.lz - b.lz);

            renderList.forEach(item => {
                if (item.lz >= 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 2, 0, Math.PI * 2); 
            this.ctx.fillStyle = colorNormal;
            this.ctx.fill();

            renderList.forEach(item => {
                if (item.lz < 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            renderList.forEach(item => {
                const tag = item;
                let baseOpacity = 0; let blur = 0; let color = 'var(--text-faint)';
                
                if (item.zRatio > 0.4) {
                    baseOpacity = 0.9; blur = 0; color = 'var(--text-normal)'; 
                } else if (item.zRatio > 0) {
                    baseOpacity = 0.4 + 0.5 * (item.zRatio / 0.4); blur = 0; color = 'var(--text-muted)'; 
                } else {
                    baseOpacity = 0.1 + 0.3 * ((item.zRatio + 1) / 1); 
                    blur = Math.min(2.0, Math.abs(item.zRatio) * 2.0); color = 'var(--text-faint)';
                }

                const depthScale = 0.6 + 0.5 * ((this.radius + tag.lz) / (2 * this.radius)); 
                const baseTransform = `translate(-50%, -50%) translate3d(${tag.lx}px, ${tag.ly}px, 0px)`;
                
                tag.el.style.transform = `${baseTransform} scale(${depthScale})`;
                tag.el.style.opacity = baseOpacity.toString();
                tag.el.style.color = color;
                tag.el.style.filter = `blur(${blur}px)`;
                tag.el.style.zIndex = Math.round(tag.lz + this.radius).toString();
            });

            this.animationFrameId = window.requestAnimationFrame(animate);
        };

        animate();
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string) {
        let depthOpacity = 0;
        let depthWidth = 0.3;
        
        if (item.zRatio > 0) {
            depthOpacity = 0.05 + 0.12 * item.zRatio; 
            depthWidth = 0.3 + 0.3 * item.zRatio;
        } else {
            depthOpacity = 0.05 * (1 - Math.abs(item.zRatio)); 
            depthWidth = 0.3;
        }

        if (depthOpacity <= 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.lx, cy + item.ly);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);
        this.ctx.strokeStyle = `rgba(${neutralRGB}, ${depthOpacity})`;
        this.ctx.stroke();
        this.ctx.restore();
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
            // 核心修改 1：提取数量从 42 降为 32 个，制造充足的内部留白，解决拥挤问题
            .slice(0, 32) 
            .map(([word, value]) => ({ word, value }));

        if (results.length < 15) {
            return FALLBACK_WORDS;
        }

        return results;
    } catch (e) {
        console.error("Topology Data Error: ", e);
        return FALLBACK_WORDS;
    }
}

export default class MobileStatsPlugin extends Plugin {
    sphereEngine: WordSphereDecorativeEngine | null = null;
    injectedContainer: HTMLElement | null = null;
    cachedWords: {word: string, value: number}[] | null = null;

    async onload() {
        this.app.workspace.onLayoutReady(async () => {
            this.cachedWords = await analyzeDecorativeData(this.app);
            this.injectIntoFileExplorer();
            
            this.registerInterval(window.setInterval(() => {
                this.injectIntoFileExplorer();
            }, 1500));
        });
    }
    
    async onunload() { 
        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();
        this.cachedWords = null;
    }
    
    async injectIntoFileExplorer() {
        try {
            const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
            if (fileExplorerLeaves.length === 0) return; 

            const fileExplorerContainer = fileExplorerLeaves[0].view.containerEl;
            const navContainer = fileExplorerContainer.querySelector('.nav-files-container');
            if (!navContainer) return;

            if (this.injectedContainer && document.body.contains(this.injectedContainer)) {
                return; 
            }

            if (this.sphereEngine) this.sphereEngine.destroy();

            this.injectedContainer = document.createElement('div');
            this.injectedContainer.className = 'mobile-parasitic-heatmap';
            
            // --- 核心更新 2：完美下坠居中黑魔法 ---
            this.injectedContainer.setAttribute('style', `
                width: 100%;
                height: 250px; 
                margin-top: 50px; /* 增加上方推力 */
                margin-bottom: 0px; 
                display: flex;
                flex-shrink: 0; 
                justify-content: center;
                align-items: center;
                position: relative;
                background-color: transparent;
                pointer-events: none;
                /* 终极视觉校准：直接将渲染画面强行向下平移 35px，完美填补底部空白 */
                transform: translateY(35px); 
            `);

            const heatmapDiv = this.injectedContainer.createDiv({ 
                attr: { style: 'width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;' } 
            });

            navContainer.appendChild(this.injectedContainer);
            
            const heatmapWords = this.cachedWords || FALLBACK_WORDS;
            if (heatmapWords.length === 0) return;

            const maxWordCount = heatmapWords[0].value;
            // 核心修改 3：球体自身在容器内的物理半径加大，让分布更开阔
            const baseRadius = Math.max((heatmapDiv.clientWidth / 2) * 0.85, 65); 

            this.sphereEngine = new WordSphereDecorativeEngine(heatmapDiv, baseRadius);

            heatmapWords.forEach(({word, value}) => {
                const wordEl = document.createElement('div');
                wordEl.innerText = word;
                
                // 核心修改 4：字号整体调小一圈（11~21px），配合更少的词汇量，彻底解锁“高级松弛感”
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
        } catch (e) {
            console.error("Topology Render Error: ", e);
        }
    }
}
