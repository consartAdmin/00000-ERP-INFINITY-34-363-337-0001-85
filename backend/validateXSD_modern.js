const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { NFeSchemaValidator } = require('./public/faturamento/services/nfeSchemaValidator');

// Validador moderno sem libxmljs
function validateNFeStructure(xmlPath) {
    try {
        console.log(`\n=== Validação Moderna NF-e ===`);
        console.log(`Arquivo: ${xmlPath}`);
        
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        
        // 1. Validação usando NFeSchemaValidator (já existente)
        const validator = new NFeSchemaValidator();
        const result = validator.validate(xmlContent);
        
        console.log('\n=== Validação de Schema ===');
        if (result.isValid) {
            console.log('✅ XML válido segundo regras de negócio!');
        } else {
            console.log('❌ Problemas encontrados:');
            result.errors.forEach((error, i) => {
                console.log(`  ${i + 1}. ${error}`);
            });
        }
        
        if (result.warnings.length > 0) {
            console.log('\n⚠️  Avisos:');
            result.warnings.forEach((warning, i) => {
                console.log(`  ${i + 1}. ${warning}`);
            });
        }
        
        // 2. Análise estrutural do enderEmit
        analyzeEnderEmitStructure(xmlContent);
        
        // 3. Verificação de duplicações
        checkDuplicateElements(xmlContent);
        
        return result.isValid;
        
    } catch (error) {
        console.error('Erro na validação:', error.message);
        return false;
    }
}

function analyzeEnderEmitStructure(xmlContent) {
    console.log(`\n=== Análise enderEmit ===`);
    
    const enderEmitMatch = xmlContent.match(/<enderEmit[^>]*>([\s\S]*?)<\/enderEmit>/g);
    
    if (!enderEmitMatch) {
        console.log('❌ enderEmit não encontrado!');
        return;
    }
    
    enderEmitMatch.forEach((enderEmitXml, index) => {
        console.log(`\nenderEmit ${index + 1}:`);
        
        // Extrair elementos
        const elementMatches = enderEmitXml.match(/<([^/>]+)>([^<]*)<\/\1>/g) || [];
        const actualElements = elementMatches.map(el => {
            const match = el.match(/<([^>\s]+)/);
            return match ? match[1] : null;
        }).filter(Boolean);
        
        console.log('Elementos encontrados:', actualElements.join(' → '));
        
        // Verificar ordem segundo schema XSD
        const expectedOrder = ['xLgr', 'nro', 'xCpl', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP', 'cPais', 'xPais', 'fone'];
        
        let orderCorrect = true;
        let lastExpectedIndex = -1;
        
        actualElements.forEach((elementName, i) => {
            const expectedIndex = expectedOrder.indexOf(elementName);
            if (expectedIndex === -1) {
                console.log(`  ❌ Elemento inesperado: ${elementName}`);
                orderCorrect = false;
            } else if (expectedIndex < lastExpectedIndex) {
                console.log(`  ❌ Fora de ordem: ${elementName}`);
                orderCorrect = false;
            } else {
                console.log(`  ✅ ${elementName} - OK`);
                lastExpectedIndex = expectedIndex;
            }
        });
        
        if (orderCorrect) {
            console.log('✅ Ordem dos elementos correta!');
        }
        
        // Verificar elementos obrigatórios
        const requiredElements = ['xLgr', 'nro', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP'];
        const missingRequired = requiredElements.filter(req => !actualElements.includes(req));
        
        if (missingRequired.length > 0) {
            console.log(`❌ Elementos obrigatórios ausentes: ${missingRequired.join(', ')}`);
        } else {
            console.log('✅ Todos elementos obrigatórios presentes!');
        }
    });
}

function checkDuplicateElements(xmlContent) {
    console.log(`\n=== Verificação de Duplicações ===`);
    
    // Verificar xCpl
    const xCplMatches = xmlContent.match(/<xCpl[^>]*>.*?<\/xCpl>/g) || [];
    const xCplEmpty = xmlContent.match(/<xCpl\s*\/>/g) || [];
    
    console.log(`Tags xCpl com conteúdo: ${xCplMatches.length}`);
    console.log(`Tags xCpl vazias: ${xCplEmpty.length}`);
    
    if (xCplMatches.length + xCplEmpty.length > 2) {
        console.log('❌ PROBLEMA: Muitas tags xCpl!');
    } else {
        console.log('✅ xCpl OK');
    }
    
    // Verificar xNome
    const xNomeMatches = xmlContent.match(/<xNome[^>]*>.*?<\/xNome>/g) || [];
    console.log(`Tags xNome: ${xNomeMatches.length}`);
    
    if (xNomeMatches.length > 2) {
        console.log('❌ PROBLEMA: Muitas tags xNome!');
    } else {
        console.log('✅ xNome OK');
    }
}

// Função principal
function main() {
    const debugDir = '/Users/eduardotrindade/Projetos/consart/backend/public/faturamento/xml/debug';
    
    const files = fs.readdirSync(debugDir);
    const xmlFiles = files.filter(f => f.includes('nfe_assinada.xml')).sort().reverse();
    
    if (xmlFiles.length === 0) {
        console.log('❌ Nenhum arquivo nfe_assinada.xml encontrado!');
        return;
    }
    
    const latestXML = path.join(debugDir, xmlFiles[0]);
    
    console.log('=== VALIDADOR MODERNO NF-e ===');
    console.log(`Arquivo: ${xmlFiles[0]}`);
    
    validateNFeStructure(latestXML);
}

if (require.main === module) {
    main();
}

module.exports = {
    validateNFeStructure,
    analyzeEnderEmitStructure,
    checkDuplicateElements
};