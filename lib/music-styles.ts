/** 音乐风格分类：category 为中文显示名，tags 为小写英文风格标签（Suno 风格标签习惯） */
export interface MusicStyleCategory {
  category: string;
  tags: string[];
}

/** 分类音乐风格词库，用于音乐生成的风格选择 */
export const MUSIC_STYLE_CATEGORIES: MusicStyleCategory[] = [
  {
    category: "流行 Pop",
    tags: ["pop", "dance pop", "synth pop", "electropop", "indie pop", "pop ballad", "teen pop", "bubblegum pop", "catchy", "upbeat"],
  },
  {
    category: "摇滚 Rock",
    tags: ["rock", "alternative rock", "indie rock", "classic rock", "hard rock", "soft rock", "progressive rock", "psychedelic rock", "garage rock", "post-rock"],
  },
  {
    category: "电子 Electronic",
    tags: ["electronic", "edm", "house", "techno", "trance", "dubstep", "drum and bass", "electro", "synthwave", "future bass"],
  },
  {
    category: "嘻哈 Hip-Hop",
    tags: ["hip hop", "rap", "trap", "boom bap", "drill", "old school hip hop", "lofi hip hop", "conscious rap", "gangsta rap", "808 bass"],
  },
  {
    category: "R&B/灵魂",
    tags: ["r&b", "soul", "neo soul", "contemporary r&b", "motown", "quiet storm", "gospel", "smooth vocals", "groovy"],
  },
  {
    category: "爵士 Jazz",
    tags: ["jazz", "smooth jazz", "bebop", "swing", "cool jazz", "jazz fusion", "bossa nova jazz", "big band", "modal jazz", "saxophone"],
  },
  {
    category: "蓝调 Blues",
    tags: ["blues", "delta blues", "chicago blues", "electric blues", "acoustic blues", "blues rock", "12-bar blues", "slide guitar", "soulful"],
  },
  {
    category: "乡村 Country",
    tags: ["country", "country pop", "americana", "bluegrass", "honky tonk", "outlaw country", "country rock", "acoustic guitar", "banjo", "storytelling"],
  },
  {
    category: "民谣 Folk",
    tags: ["folk", "indie folk", "folk rock", "acoustic folk", "singer-songwriter", "traditional folk", "fingerstyle guitar", "harmonica", "warm vocals", "intimate"],
  },
  {
    category: "古典 Classical",
    tags: ["classical", "orchestral", "symphony", "chamber music", "piano sonata", "baroque", "romantic", "string quartet", "opera", "choir"],
  },
  {
    category: "影视史诗 Cinematic",
    tags: ["cinematic", "epic", "film score", "orchestral hybrid", "trailer music", "heroic", "dramatic strings", "taiko drums", "emotional", "sweeping"],
  },
  {
    category: "氛围 Ambient",
    tags: ["ambient", "drone", "atmospheric", "soundscape", "meditation", "space ambient", "ethereal pads", "minimal", "calm", "reverb washed"],
  },
  {
    category: "Lo-Fi",
    tags: ["lo-fi", "lofi hip hop", "chillhop", "chill beats", "dusty vinyl", "tape hiss", "mellow", "jazzy chords", "study beats", "rainy day"],
  },
  {
    category: "金属 Metal",
    tags: ["metal", "heavy metal", "thrash metal", "death metal", "black metal", "power metal", "doom metal", "metalcore", "distorted guitars", "double bass drums"],
  },
  {
    category: "朋克 Punk",
    tags: ["punk", "punk rock", "pop punk", "hardcore punk", "skate punk", "post-punk", "fast tempo", "power chords", "raw energy", "rebellious"],
  },
  {
    category: "雷鬼 Reggae",
    tags: ["reggae", "dancehall", "dub", "roots reggae", "ska", "reggaeton", "offbeat rhythm", "laid back", "island vibes", "bass heavy"],
  },
  {
    category: "拉丁 Latin",
    tags: ["latin", "salsa", "bachata", "bossa nova", "samba", "tango", "flamenco", "latin pop", "cumbia", "tropical"],
  },
  {
    category: "世界/民族 World",
    tags: ["world music", "ethnic", "african drums", "indian classical", "middle eastern", "celtic", "tribal", "folk instruments", "chant", "percussion ensemble"],
  },
  {
    category: "国风/古风",
    tags: ["chinese folk", "guofeng", "guzheng", "erhu", "dizi", "pipa", "pentatonic", "ancient chinese style", "orchestral fusion", "ethereal vocals"],
  },
  {
    category: "日韩 J-Pop/K-Pop",
    tags: ["j-pop", "k-pop", "city pop", "anisong", "j-rock", "idol pop", "dance pop", "synth heavy", "catchy chorus", "energetic"],
  },
  {
    category: "动漫/游戏",
    tags: ["anime", "video game music", "chiptune", "8-bit", "jrpg soundtrack", "orchestral adventure", "battle theme", "synth arpeggios", "heroic melody", "pixel vibe"],
  },
  {
    category: "放克/迪斯科 Funk/Disco",
    tags: ["funk", "disco", "nu disco", "funk rock", "boogie", "slap bass", "wah guitar", "four on the floor", "groovy", "dance floor"],
  },
  {
    category: "实验 Experimental",
    tags: ["experimental", "avant-garde", "noise", "glitch", "idm", "industrial", "sound collage", "atonal", "abstract", "unconventional"],
  },
];
