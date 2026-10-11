const fs = require('fs')
var data = fs.readFileSync(process.argv[2] || 'grades.csv', 'utf8')
var lines = data.split('\n')
var out = []
for (var i = 1; i < lines.length; i++) {
  if (lines[i].trim() == '') continue
  var parts = lines[i].split(',')
  var name = parts[0]
  var a = parseFloat(parts[1]); var b = parseFloat(parts[2]); var c = parseFloat(parts[3])
  var total = 0
  if (!isNaN(a)) total = total + a
  if (!isNaN(b)) total = total + b
  if (!isNaN(c)) total = total + c
  var avg = total / 3
  var letter = ''
  if (avg >= 90) { letter = 'A' } else { if (avg >= 80) { letter = 'B' } else { if (avg >= 70) { letter = 'C' } else { if (avg >= 60) { letter = 'D' } else { letter = 'F' } } } }
  out.push(name + ': ' + avg.toFixed(1) + ' ' + letter)
}
for (var i = 1; i < lines.length; i++) {
  if (lines[i].trim() == '') continue
  var parts = lines[i].split(',')
  var name = parts[0]
  var a = parseFloat(parts[1]); var b = parseFloat(parts[2]); var c = parseFloat(parts[3])
  var total = 0
  if (!isNaN(a)) total = total + a
  if (!isNaN(b)) total = total + b
  if (!isNaN(c)) total = total + c
  var avg = total / 3
  if (avg < 60) { out.push('WARNING: ' + name + ' is failing') }
}
console.log(out.join('\n'))
