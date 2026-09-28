const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

// Função para analisar estrutura do enderEmit
function analyzeEnderEmitStructure(xmlPath) {
    try {
        console.log(`\n=== Analisando estrutura do enderEmit ===`);
        console.log(`Arquivo: ${xmlPath}`);
        
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        
        // Buscar enderEmit usando regex
        const enderEmitMatch = xmlContent.match(/<enderEmit[^>]*>([\s\S]*?)<\/enderEmit>/g);
        
        if (!enderEmitMatch) {
            console.log('❌ Nenhum elemento enderEmit encontrado!');
            return;
        }
        
        enderEmitMatch.forEach((enderEmitXml, index) => {
            console.log(`\nenderEmit ${index + 1}:`);
            console.log('Conteúdo XML:');
            console.log(enderEmitXml);
            
            // Extrair elementos individuais
            const elementMatches = enderEmitXml.match(/<([^/>]+)>([^<]*)<\/\1>/g) || [];
            
            console.log('\nElementos encontrados:');
            elementMatches.forEach((element, i) => {
                const match = element.match(/<([^>]+)>([^<]*)<\/\1>/);
                if (match) {
                    const tagName = match[1];
                    const content = match[2];
                    console.log(`  ${i + 1}. <${tagName}>${content}</${tagName}>`);
                }
            });
            
            // Verificar ordem correta segundo schema XSD
            const expectedOrder = ['xLgr', 'nro', 'xCpl', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP', 'cPais', 'xPais', 'fone'];
            const actualElements = elementMatches.map(el => {
                const match = el.match(/<([^>\s]+)/);
                return match ? match[1] : null;
            }).filter(Boolean);
            
            console.log('\nVerificação de ordem segundo schema XSD:');
            console.log('Ordem esperada:', expectedOrder.join(' → '));
            console.log('Ordem atual:', actualElements.join(' → '));
            
            let orderCorrect = true;
            let lastExpectedIndex = -1;
            
            actualElements.forEach((elementName, i) => {
                const expectedIndex = expectedOrder.indexOf(elementName);
                if (expectedIndex === -1) {
                    console.log(`  ❌ Elemento inesperado: ${elementName}`);
                    orderCorrect = false;
                } else if (expectedIndex < lastExpectedIndex) {
                    console.log(`  ❌ Elemento fora de ordem: ${elementName} (posição ${i + 1})`);
                    orderCorrect = false;
                } else {
                    console.log(`  ✅ ${elementName} (posição ${i + 1}) - OK`);
                    lastExpectedIndex = expectedIndex;
                }
            });
            
            if (orderCorrect) {
                console.log('\n✅ Ordem dos elementos está CORRETA segundo o schema XSD!');
            } else {
                console.log('\n❌ Ordem dos elementos está INCORRETA segundo o schema XSD!');
            }
            
            // Verificar elementos obrigatórios
            const requiredElements = ['xLgr', 'nro', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP'];
            const missingRequired = requiredElements.filter(req => !actualElements.includes(req));
            
            if (missingRequired.length > 0) {
                console.log(`\n❌ Elementos obrigatórios ausentes: ${missingRequired.join(', ')}`);
            } else {
                console.log('\n✅ Todos os elementos obrigatórios estão presentes!');
            }
        });
        
    } catch (error) {
        console.error('Erro ao analisar enderEmit:', error.message);
    }
}

// Função para verificar duplicações
function checkDuplicateElements(xmlPath) {
    try {
        console.log(`\n=== Verificando elementos duplicados ===`);
        
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        
        // Verificar duplicações de xCpl
        const xCplMatches = xmlContent.match(/<xCpl[^>]*>.*?<\/xCpl>/g) || [];
        const xCplEmpty = xmlContent.match(/<xCpl\s*\/>/g) || [];
        
        console.log(`Elementos <xCpl> com conteúdo: ${xCplMatches.length}`);
        xCplMatches.forEach((match, i) => {
            console.log(`  ${i + 1}. ${match}`);
        });
        
        console.log(`Elementos <xCpl/> vazios: ${xCplEmpty.length}`);
        xCplEmpty.forEach((match, i) => {
            console.log(`  ${i + 1}. ${match}`);
        });
        
        if (xCplMatches.length + xCplEmpty.length > 1) {
            console.log('❌ PROBLEMA: Múltiplas tags xCpl encontradas!');
        } else {
            console.log('✅ Nenhuma duplicação de xCpl encontrada.');
        }
        
    } catch (error) {
        console.error('Erro ao verificar duplicações:', error.message);
    }
}

// Função principal
function main() {
    const debugDir = '/Users/eduardotrindade/Projetos/consart/backend/public/faturamento/xml/debug';
    
    // Encontrar o XML mais recente
    const files = fs.readdirSync(debugDir);
    const xmlFiles = files.filter(f => f.includes('nfe_assinada.xml')).sort().reverse();
    
    if (xmlFiles.length === 0) {
        console.log('❌ Nenhum arquivo nfe_assinada.xml encontrado!');
        
        // Tentar encontrar outros XMLs
        const otherXmls = files.filter(f => f.endsWith('.xml')).sort().reverse();
        if (otherXmls.length > 0) {
            console.log('\nArquivos XML disponíveis:');
            otherXmls.slice(0, 5).forEach(f => console.log(`  - ${f}`));
            
            const latestXML = path.join(debugDir, otherXmls[0]);
            console.log(`\nAnalisando arquivo mais recente: ${otherXmls[0]}`);
            
            analyzeEnderEmitStructure(latestXML);
            checkDuplicateElements(latestXML);
        }
        return;
    }
    
    const latestXML = path.join(debugDir, xmlFiles[0]);
    
    console.log('=== VALIDADOR ESTRUTURAL NF-e ===');
    console.log(`Arquivo XML mais recente: ${xmlFiles[0]}`);
    
    // Analisar estrutura do enderEmit
    analyzeEnderEmitStructure(latestXML);
    
    // Verificar duplicações
    checkDuplicateElements(latestXML);
}

if (require.main === module) {
    main();
}

module.exports = {
    analyzeEnderEmitStructure,
    checkDuplicateElements
};