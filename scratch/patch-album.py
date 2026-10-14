import io
def patch(p, pairs):
    s=io.open(p,encoding='utf8').read()
    for a,b in pairs:
        assert a in s,(p,a[:70]); s=s.replace(a,b,1)
    io.open(p,'w',encoding='utf8').write(s)
patch('media/windows-media.ps1',[("title=$properties.Title;artist=$properties.Artist;","title=$properties.Title;artist=$properties.Artist;album=$properties.AlbumTitle;albumArtist=$properties.AlbumArtist;")])
patch('media/media.cjs',[("return { title:text(selected.title), artist:text(selected.artist),","return { title:text(selected.title), artist:text(selected.artist), album:text(selected.album), albumArtist:text(selected.albumArtist),")])
patch('main.cjs',[("wc.send('track', { key, title: sel.title, artist: sel.artist, app: sel.provider });","wc.send('track', { key, title: sel.title, artist: sel.artist, album: sel.album, albumArtist: sel.albumArtist, app: sel.provider });")])
patch('being/index.html',[
 ("    MEM.meta = { ...stored.meta, title: t.title, artist: t.artist, plays:","    MEM.meta = { ...stored.meta, title: t.title, artist: t.artist, album: t.album || stored.meta.album || '', albumArtist: t.albumArtist || stored.meta.albumArtist || '', plays:"),
 ("    MEM.meta = { title: t.title, artist: t.artist, plays: 1,","    MEM.meta = { title: t.title, artist: t.artist, album: t.album || '', albumArtist: t.albumArtist || '', plays: 1,"),
])
print('ok')
