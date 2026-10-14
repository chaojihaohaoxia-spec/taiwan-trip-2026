var o=null;function l(n,t=Date.now()){o=n?{placeId:n,at:t}:null}function r(n,t=Date.now()){let e=o;return o=null,!!(e&&n&&e.placeId===n&&t-e.at>=0&&t-e.at<18e5)}export{l as a,r as b};
