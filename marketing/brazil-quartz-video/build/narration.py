import sherpa_onnx, soundfile as sf, sys, json

SEGMENTS = {
    "s1": "大家好！我们刚刚结束了巴西的水晶原石采购之旅，为大家带回了品质一流的巴西水晶。",
    "s2": "在巴西矿区，我们亲自考察，逐批挑选，只选晶体通透、成色好的原石。",
    "s3": "首批近八吨高品质白水晶原石已经发货，正运往中国。",
    "s4": "这次考察我们还发现了不少新品：颜色饱满的紫水晶，还有红碧玉等特色原石，也在陆续到货。",
    "s5": "所有货品直达我们东海的仓库，曲阳水晶街赵庄村。规格齐全，现货供应，欢迎到仓库现场看货挑选。",
    "s6": "按规格定价，量大优惠。扫码加微信，询价、看货、长期合作。我们在水晶街等您！",
}

config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model="kokoro-multi-lang-v1_0/model.onnx",
            voices="kokoro-multi-lang-v1_0/voices.bin",
            tokens="kokoro-multi-lang-v1_0/tokens.txt",
            data_dir="kokoro-multi-lang-v1_0/espeak-ng-data",
            dict_dir="kokoro-multi-lang-v1_0/dict",
            lexicon="kokoro-multi-lang-v1_0/lexicon-us-en.txt,kokoro-multi-lang-v1_0/lexicon-zh.txt",
        ),
        num_threads=4,
    ),
    max_num_sentences=1,
)
tts = sherpa_onnx.OfflineTts(config)
sid = int(sys.argv[1]) if len(sys.argv) > 1 else 48
durations = {}
for key, text in SEGMENTS.items():
    audio = tts.generate(text, sid=sid, speed=0.94)
    sf.write(f"audio/{key}.wav", audio.samples, audio.sample_rate)
    durations[key] = round(len(audio.samples) / audio.sample_rate, 2)
print(json.dumps(durations))
