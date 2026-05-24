'use strict';

const CITIES=[
  ['Toronto',43.6532,-79.3832],
  ['Vancouver',49.2827,-123.1207],
  ['Los Angeles',34.0522,-118.2437],
  ['Atlanta',33.749,-84.388],
  ['NYC',40.7128,-74.006],
  ['London',51.5074,-.1278],
  ['Vegas',36.1699,-115.1398],
  ['Albuquerque',35.0844,-106.6504]
];

const RING_COLORS=['#7fb7ff','#b9a7ff','#8bd3ff','#d5c7ff','#a7b8ff','#78a6c8','#c5d4e6','#9aa8bd'];

const MICS={
  mkh416:{name:'Sennheiser MKH 416',short:'MKH 416',kind:'boom shotgun',mic:13,hot:6.5,tail:35,ceil:12000},
  mkh8060:{name:'Sennheiser MKH 8060',short:'MKH 8060',kind:'boom shotgun',mic:14,hot:7,tail:38,ceil:13000},
  mkh50:{name:'Sennheiser MKH 50',short:'MKH 50',kind:'interior boom',mic:10,hot:5,tail:25,ceil:10000},
  cmit:{name:'Schoeps CMIT 5U',short:'CMIT 5U',kind:'boom shotgun',mic:15,hot:7.5,tail:40,ceil:14000},
  minicmit:{name:'Schoeps MiniCMIT',short:'MiniCMIT',kind:'boom shotgun',mic:14,hot:7,tail:38,ceil:13000},
  mk41:{name:'Schoeps CMC/MK 41',short:'MK 41',kind:'dialogue boom',mic:11,hot:5.5,tail:28,ceil:11000},
  dpa4017:{name:'DPA 4017',short:'DPA 4017',kind:'boom shotgun',mic:15,hot:7.5,tail:40,ceil:14000},
  dpa4018:{name:'DPA 4018',short:'DPA 4018',kind:'dialogue boom',mic:11,hot:5.5,tail:28,ceil:11000},
  cos11d:{name:'Sanken COS-11D',short:'COS-11D',kind:'lav',mic:18,hot:9,tail:50,ceil:15000},
  dpa4060:{name:'DPA 4060',short:'DPA 4060',kind:'lav',mic:20,hot:10,tail:55,ceil:16000},
  dpa6060:{name:'DPA 6060',short:'DPA 6060',kind:'lav',mic:19,hot:9.5,tail:52,ceil:16000},
  b6:{name:'Countryman B6',short:'B6',kind:'lav',mic:18,hot:9,tail:50,ceil:15000},
  mke2:{name:'Sennheiser MKE 2',short:'MKE 2',kind:'lav',mic:17,hot:8.5,tail:48,ceil:15000},
  twinplex:{name:'Shure TwinPlex TL47',short:'TwinPlex',kind:'lav',mic:19,hot:9.5,tail:52,ceil:16000,aliases:['TL47']}
};
